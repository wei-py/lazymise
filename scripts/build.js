import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { getNodeAssets } from '@opentui/core/node-assets'
import { build } from 'esbuild'
import { inject } from 'postject'
import { releaseTarget } from '../src/release.js'

const root = join(import.meta.dirname, '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (process.versions.node !== '24.22.1')
  throw new Error('Node.js 24.22.1 is required to build releases.')
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
const koffiDirectory = await packageDirectory('koffi', root)
const koffiNativePackage = `@koromix/koffi-${process.platform}-${process.arch}`
const koffiNativeDirectory = await packageDirectory(koffiNativePackage, koffiDirectory)
assets.push({
  key: 'koffi.node',
  source: join(koffiNativeDirectory, `${process.platform}_${process.arch}`, 'koffi.node'),
})
const bundle = join(buildDirectory, 'main.mjs')
await build({
  entryPoints: [join(root, 'src/main.js')],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  define: { 'import.meta.main': 'false' },
  plugins: [{
    name: 'external-ffi-registration',
    setup(builder) {
      builder.onResolve({ filter: /^\.\/register-ffi\.js$/ }, () => ({
        path: './register-ffi.mjs',
        external: true,
      }))
    },
  }],
})
const adapter = join(buildDirectory, 'ffi.cjs')
await build({
  entryPoints: [join(root, 'src/ffi.cjs')],
  outfile: adapter,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node24',
  external: ['./koffi.node'],
  plugins: [{
    name: 'embedded-koffi-addon',
    setup(builder) {
      // Keep Koffi's public JS wrappers, but load only the embedded host addon.
      builder.onLoad({ filter: /[/\\]koffi[/\\]src[/\\]static\.cjs$/ }, () => ({
        contents: 'exports.loadStatic = () => require("./koffi.node")',
        loader: 'js',
      }))
    },
  }],
})
const registration = join(buildDirectory, 'register-ffi.mjs')
await copyFile(join(root, 'src/register-ffi.js'), registration)
assets.push(
  { key: 'main.mjs', source: bundle },
  { key: 'ffi.cjs', source: adapter },
  { key: 'register-ffi.mjs', source: registration },
)

// Node 24 SEAs start in CommonJS. Extract ESM and native assets before importing
// the FFI hook, then load Core-containing code only after that hook is active.
const bootstrap = join(buildDirectory, 'bootstrap.cjs')
await writeFile(bootstrap, `const { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { getRawAsset, isSea } = require('node:sea');
if (!isSea()) throw new Error('Expected a Node SEA executable');
// Loaded DLLs stay locked on Windows. Reclaim only assets owned by dead processes.
if (process.platform === 'win32') {
  for (const entry of readdirSync(tmpdir(), { withFileTypes: true })) {
    const owner = /^lazymise-opentui-(\\d+)-/.exec(entry.name);
    if (!entry.isDirectory() || !owner) continue;
    try { process.kill(Number(owner[1]), 0); }
    catch (error) {
      if (error.code === 'ESRCH') rmSync(join(tmpdir(), entry.name), { recursive: true, force: true });
      else if (error.code !== 'EPERM') throw error;
    }
  }
}
const assetRoot = mkdtempSync(join(tmpdir(), 'lazymise-opentui-' + process.pid + '-'));
if (process.platform !== 'win32') process.once('exit', () => rmSync(assetRoot, { recursive: true, force: true }));
(async () => {
  try {
    for (const key of ${JSON.stringify(assets.map(({ key }) => key))}) {
      const path = join(assetRoot, key);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, new Uint8Array(getRawAsset(key)), { mode: 0o600 });
    }
  } catch (error) { rmSync(assetRoot, { recursive: true, force: true }); throw error; }
  process.env.OTUI_ASSET_ROOT = assetRoot;
  ${process.platform === 'linux' ? 'process.env.OPENTUI_LIBC = \'glibc\';' : ''}
  await import(pathToFileURL(join(assetRoot, 'register-ffi.mjs')).href);
  const { main } = await import(pathToFileURL(join(assetRoot, 'main.mjs')).href);
  process.exitCode = await main();
})().catch(error => { console.error(error); process.exitCode = 1; });
`)
const output = join(staging, target.binaryName)
const blob = join(buildDirectory, 'sea-prep.blob')
const configPath = join(buildDirectory, 'sea-config.json')
await writeFile(configPath, `${JSON.stringify({
  main: bootstrap,
  output: blob,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  execArgv: ['--no-warnings'],
  execArgvExtension: 'none',
  assets: Object.fromEntries(assets.map(({ key, source }) => [key, source])),
}, null, 2)}\n`)
run(process.execPath, ['--experimental-sea-config', configPath])
await copyFile(process.execPath, output)
let entitlements
if (process.platform === 'darwin') {
  entitlements = join(buildDirectory, 'node-entitlements.plist')
  run('codesign', ['--display', '--entitlements', entitlements, '--xml', process.execPath])
  run('plutil', ['-lint', entitlements])
  run('codesign', ['--remove-signature', output])
}
await inject(output, 'NODE_SEA_BLOB', await readFile(blob), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
})
if (process.platform === 'darwin') {
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
await copyNotices(koffiNativePackage, koffiDirectory)
const archive = join(dist, target.archiveName)
run('tar', ['-a', '-cf', archive, '-C', dist, target.directory])
const checksum = createHash('sha256').update(await readFile(archive)).digest('hex')
await writeFile(join(dist, 'SHA256SUMS'), `${checksum}  ${target.archiveName}\n`)
await rm(buildDirectory, { recursive: true, force: true })
process.stdout.write(`Release v${pkg.version}: ${archive}\n`)
