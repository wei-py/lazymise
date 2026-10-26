import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import * as pty from '@lydell/node-pty'
import { inject } from 'postject'
import { runProcess } from '../src/process.js'
import { releaseTarget } from '../src/release.js'

const execFile = promisify(execFileCallback)
const root = join(import.meta.dirname, '..')
const target = releaseTarget()
const temporary = await mkdtemp(join(tmpdir(), 'lazymise-release-'))
try {
  const assetTemporary = join(temporary, 'native-assets')
  const fixtures = join(temporary, 'fixtures')
  await mkdir(assetTemporary)
  await mkdir(fixtures)
  const archive = join(root, 'dist', target.archiveName)
  const hash = createHash('sha256').update(await readFile(archive)).digest('hex')
  assert.equal((await readFile(join(root, 'dist/SHA256SUMS'), 'utf8')).trim(), `${hash}  ${target.archiveName}`)
  await execFile('tar', ['-xf', archive, '-C', temporary])
  const binary = join(temporary, target.directory, target.binaryName)
  assert.ok((await readdir(join(temporary, target.directory, 'licenses'))).length > 0)

  // A real native fixture executable also works with Windows spawn (no shell or .cmd shim).
  const fixtureSource = join(fixtures, 'mise.cjs')
  const fixtureBinary = join(fixtures, process.platform === 'win32' ? 'mise.exe' : 'mise')
  await writeFile(fixtureSource, `
;(async () => {
const args = process.argv.slice(2);
if (args[0] === 'run') {
  for await (const chunk of process.stdin) process.stdout.write(chunk);
  process.stderr.write('fixture stderr\\n');
  process.exitCode = 7;
} else if (args[0] === '--version') console.log('mise fixture');
else if (['config','tasks','registry','ls-remote'].includes(args[0])) console.log('[]');
else console.log('{}');
})().catch(error => { console.error(error); process.exitCode = 1; });
`)
  const fixtureConfig = join(fixtures, 'sea.json')
  const fixtureBlob = join(fixtures, 'sea.blob')
  await writeFile(fixtureConfig, JSON.stringify({
    main: fixtureSource,
    output: fixtureBlob,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  }))
  await execFile(process.execPath, ['--experimental-sea-config', fixtureConfig])
  await copyFile(process.execPath, fixtureBinary)
  let entitlements
  if (process.platform === 'darwin') {
    entitlements = join(fixtures, 'entitlements.plist')
    await execFile('codesign', ['--display', '--entitlements', entitlements, '--xml', process.execPath])
    await execFile('codesign', ['--remove-signature', fixtureBinary])
  }
  await inject(fixtureBinary, 'NODE_SEA_BLOB', await readFile(fixtureBlob), {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
  })
  if (process.platform === 'darwin')
    await execFile('codesign', ['--sign', '-', '--force', '--entitlements', entitlements, fixtureBinary])
  if (process.platform !== 'win32')
    await chmod(fixtureBinary, 0o755)
  const env = Object.fromEntries(Object.entries({
    PATH: fixtures,
    HOME: temporary,
    USERPROFILE: temporary,
    XDG_CONFIG_HOME: join(temporary, 'preferences'),
    LAZYMISE_CONFIG_DIR: join(temporary, 'preferences/lazymise'),
    MISE_CONFIG_DIR: join(temporary, 'mise-config'),
    MISE_DATA_DIR: join(temporary, 'mise-data'),
    MISE_CACHE_DIR: join(temporary, 'mise-cache'),
    TERM: 'xterm-256color',
    TMPDIR: assetTemporary,
    TEMP: assetTemporary,
    TMP: assetTemporary,
    ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, SystemDrive: process.env.SystemDrive } : {}),
  }).filter(([, value]) => value !== undefined))
  const command = process.platform === 'darwin'
    ? ['/usr/bin/sandbox-exec', '-p', `(version 1)(allow default)(deny file-read* (subpath ${JSON.stringify(root)}))`, binary]
    : [binary]
  const run = args => runProcess(command[0], [...command.slice(1), ...args], { cwd: temporary, env })
  const diagnostics = (name, child) =>
    `${name}: exit=${child.exitCode}\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`
  const help = await run(['--help'])
  assert.equal(help.exitCode, 0, diagnostics('Help', help))
  assert.match(help.stdout, /Usage:/, diagnostics('Help', help))
  const version = await run(['--version'])
  assert.equal(version.exitCode, 0, diagnostics('Version', version))
  assert.match(version.stdout, /^lazymise \d+\.\d+\.\d+/, diagnostics('Version', version))
  const guard = await run([])
  assert.equal(guard.exitCode, 1, diagnostics('TTY guard', guard))
  assert.match(guard.stderr, /TTY/, diagnostics('TTY guard', guard))
  const forwarded = await runProcess(command[0], [...command.slice(1), 'run', 'smoke'], {
    cwd: temporary,
    env,
    input: 'fixture stdin\n',
  })
  assert.equal(forwarded.exitCode, 7, diagnostics('Forwarded command', forwarded))
  assert.match(forwarded.stdout, /fixture stdin/, diagnostics('Forwarded command', forwarded))
  assert.match(forwarded.stderr, /fixture stderr/, diagnostics('Forwarded command', forwarded))

  let output = ''
  let closing = false
  const terminal = pty.spawn(binary, [], { cols: 120, rows: 40, cwd: temporary, env, name: 'xterm-256color' })
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { terminal.kill(); reject(new Error(`Native TUI timed out: ${output}`)) }, 20000)
    terminal.onData((data) => {
      output += data
      if (!closing && /LAZYMISE|Tools/.test(output)) {
        closing = true
        setTimeout(() => terminal.write('q'), 150)
      }
    })
    terminal.onExit((event) => { clearTimeout(timer); resolve(event) })
  })
  assert.ok(closing, `Native TUI never rendered: ${output}`)
  assert.equal(result.exitCode, 0, output)
  assert.match(output, /\x1B\[\?1049h/, `TUI must enter alternate screen:\n${output}`)
  assert.match(output, /\x1B\[\?1049l/, `TUI must restore normal screen on quit:\n${output}`)
  if (process.platform !== 'win32')
    assert.deepEqual(await readdir(assetTemporary), [], 'Packaged processes must clean up native assets')
  process.stdout.write('Release smoke passed: checksum/archive, isolated help/version, TTY guard, real argv/stdin/output/exit forwarding, native TUI startup/quit, terminal and asset cleanup.\n')
}
finally {
  await rm(temporary, { recursive: true, force: true })
}
