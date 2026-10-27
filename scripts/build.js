import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { releaseTarget } from '../src/release.js'
import './check-release-tag.js'

const root = join(import.meta.dirname, '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (Bun.version !== '1.4.2')
  throw new Error('Bun 1.4.2 is required to build releases.')
const target = releaseTarget()
const dist = join(root, 'dist')
const staging = join(dist, target.directory)
await rm(staging, { recursive: true, force: true })
await mkdir(staging, { recursive: true })

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`Command failed (${result.status}): ${command}`)
}

const output = join(staging, target.binaryName)
const platform = process.platform === 'win32' ? 'windows' : process.platform
const result = await Bun.build({
  entrypoints: [join(root, 'src/main.js')],
  compile: {
    target: `bun-${platform}-${process.arch}${process.arch === 'x64' ? '-baseline' : ''}`,
    outfile: output,
  },
  define: {
    LAZYMISE_STANDALONE: 'true',
    ...(process.platform === 'linux' ? { 'process.env.OPENTUI_LIBC': JSON.stringify('glibc') } : {}),
  },
})
if (!result.success)
  throw new AggregateError(result.logs, 'Bun standalone compilation failed.')
if (process.platform !== 'win32')
  await chmod(output, 0o755)
for (const file of ['README.md', 'LICENSE']) await copyFile(join(root, file), join(staging, file))

// Resolve notices from each package's own dependency graph.
async function packageDirectory(name, from) {
  const require = createRequire(join(from, 'package.json'))
  for (const directory of require.resolve.paths(name) ?? []) {
    try { return await realpath(join(directory, name)) }
    catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')
        throw error
    }
  }
  throw new Error(`Cannot locate package metadata for ${name}.`)
}
const visited = new Set()
async function copyNotices(name, from) {
  const directory = await packageDirectory(name, from)
  if (visited.has(directory))
    return
  visited.add(directory)
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^(?:licen[cs]e|copying|notice|patents|authors)(?:[.-]|$)/i.test(entry.name))
      continue
    const destination = join(staging, 'licenses', name, metadata.version)
    await mkdir(destination, { recursive: true })
    await copyFile(join(directory, entry.name), join(destination, entry.name))
  }
  for (const dependency of Object.keys({ ...metadata.dependencies, ...metadata.peerDependencies })) {
    if (metadata.peerDependenciesMeta?.[dependency]?.optional) {
      try { await packageDirectory(dependency, directory) }
      catch { continue }
    }
    await copyNotices(dependency, directory)
  }
}
for (const name of Object.keys(pkg.dependencies)) await copyNotices(name, root)
await copyNotices(target.nativePackage, await packageDirectory('@opentui/core', root))
const archive = join(dist, target.archiveName)
run('tar', ['-a', '-cf', archive, '-C', dist, target.directory])
const checksum = createHash('sha256').update(await readFile(archive)).digest('hex')
await writeFile(join(dist, 'SHA256SUMS'), `${checksum}  ${target.archiveName}\n`)
process.stdout.write(`Release v${pkg.version}: ${archive}\n`)
