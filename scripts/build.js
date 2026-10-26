import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { getNodeAssets } from '@opentui/core/node-assets'
import { build } from 'esbuild'
import { releaseTarget } from '../src/release.js'

const root = join(import.meta.dirname, '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 26 || (major === 26 && minor < 4))
  throw new Error('Node.js >=26.4.0 is required to build releases.')
const tag = process.env.RELEASE_TAG || (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : null)
if (tag && tag !== `v${pkg.version}`)
  throw new Error(`Release tag must match package.json: v${pkg.version}`)
const target = releaseTarget()
const dist = join(root, 'dist')
const buildDirectory = join(dist, '.sea')
const staging = join(dist, target.directory)
await rm(buildDirectory, { recursive: true, force: true })
await rm(staging, { recursive: true, force: true })
await mkdir(buildDirectory, { recursive: true })
await mkdir(staging, { recursive: true })

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error)
    throw result.error
  if (result.status !== 0)
    throw new Error(`Command failed (${result.status}): ${command}`)
}

const assets = getNodeAssets({
  platform: process.platform,
  arch: process.arch,
  ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
})
const bundle = join(buildDirectory, 'bundle.mjs')
await build({
  entryPoints: [join(root, 'src/main.js')],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node26',
  banner: {
    js: `import { mkdirSync as seaMkdir, mkdtempSync as seaMkdtemp, readdirSync as seaReaddir, rmSync as seaRm, writeFileSync as seaWrite } from 'node:fs';
import { tmpdir as seaTmpdir } from 'node:os';
import { dirname as seaDirname, join as seaJoin } from 'node:path';
import { getRawAsset as seaGetAsset, isSea as seaIsSea } from 'node:sea';
if (!seaIsSea()) throw new Error('Expected a Node SEA executable');
// Loaded DLLs stay locked on Windows. Reclaim only assets owned by dead processes.
if (process.platform === 'win32') {
  for (const entry of seaReaddir(seaTmpdir(), { withFileTypes: true })) {
    const owner = /^lazymise-opentui-(\\d+)-/.exec(entry.name);
    if (!entry.isDirectory() || !owner) continue;
    try { process.kill(Number(owner[1]), 0); }
    catch (error) {
      if (error.code === 'ESRCH') seaRm(seaJoin(seaTmpdir(), entry.name), { recursive: true, force: true });
      else if (error.code !== 'EPERM') throw error;
    }
  }
}
const seaRoot = seaMkdtemp(seaJoin(seaTmpdir(), 'lazymise-opentui-' + process.pid + '-'));
if (process.platform !== 'win32') process.once('exit', () => seaRm(seaRoot, { recursive: true, force: true }));
try {
  for (const key of ${JSON.stringify(assets.map(({ key }) => key))}) {
    const path = seaJoin(seaRoot, key);
    seaMkdir(seaDirname(path), { recursive: true, mode: 0o700 });
    seaWrite(path, new Uint8Array(seaGetAsset(key)), { mode: 0o600 });
  }
} catch (error) { seaRm(seaRoot, { recursive: true, force: true }); throw error; }
process.env.OTUI_ASSET_ROOT = seaRoot;
${process.platform === 'linux' ? 'process.env.OPENTUI_LIBC = \'glibc\';' : ''}`,
  },
})
const output = join(staging, target.binaryName)
const configPath = join(buildDirectory, 'sea-config.json')
await writeFile(configPath, `${JSON.stringify({
  main: bundle,
  mainFormat: 'module',
  executable: process.execPath,
  output,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  execArgv: ['--experimental-ffi', '--no-warnings'],
  execArgvExtension: 'none',
  assets: Object.fromEntries(assets.map(({ key, source }) => [key, source])),
}, null, 2)}\n`)
run(process.execPath, ['--build-sea', configPath])
if (process.platform === 'darwin') {
  const entitlements = join(buildDirectory, 'node-entitlements.plist')
  run('codesign', ['--display', '--entitlements', entitlements, '--xml', process.execPath])
  run('plutil', ['-lint', entitlements])
  run('codesign', ['--sign', '-', '--force', '--entitlements', entitlements, output])
  run('codesign', ['--verify', '--strict', output])
}
if (process.platform !== 'win32')
  await chmod(output, 0o755)
for (const file of ['README.md', 'LICENSE']) await copyFile(join(root, file), join(staging, file))

// Resolve notices from each package's own graph, including pnpm's nested native packages.
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
await rm(buildDirectory, { recursive: true, force: true })
process.stdout.write(`Release v${pkg.version}: ${archive}\n`)
