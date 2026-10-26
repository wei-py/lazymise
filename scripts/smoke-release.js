import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import * as pty from '@lydell/node-pty'
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
  const fixtureSource = join(fixtures, 'mise.mjs')
  const fixtureBinary = join(fixtures, process.platform === 'win32' ? 'mise.exe' : 'mise')
  await writeFile(fixtureSource, `
const args = process.argv.slice(2);
if (args[0] === 'run') {
  for await (const chunk of process.stdin) process.stdout.write(chunk);
  process.stderr.write('fixture stderr\\n');
  process.exitCode = 7;
} else if (args[0] === '--version') console.log('mise fixture');
else if (['config','tasks','registry','ls-remote'].includes(args[0])) console.log('[]');
else console.log('{}');
`)
  const fixtureConfig = join(fixtures, 'sea.json')
  await writeFile(fixtureConfig, JSON.stringify({
    main: fixtureSource,
    mainFormat: 'module',
    executable: process.execPath,
    output: fixtureBinary,
    disableExperimentalSEAWarning: true,
    execArgvExtension: 'none',
  }))
  await execFile(process.execPath, ['--build-sea', fixtureConfig])
  if (process.platform === 'darwin') {
    const entitlements = join(fixtures, 'entitlements.plist')
    await execFile('codesign', ['--display', '--entitlements', entitlements, '--xml', process.execPath])
    await execFile('codesign', ['--sign', '-', '--force', '--entitlements', entitlements, fixtureBinary])
  }
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
  const help = await run(['--help'])
  assert.equal(help.exitCode, 0)
  assert.match(help.stdout, /Usage:/)
  const version = await run(['--version'])
  assert.equal(version.exitCode, 0)
  assert.match(version.stdout, /^lazymise \d+\.\d+\.\d+/)
  const guard = await run([])
  assert.equal(guard.exitCode, 1)
  assert.match(guard.stderr, /TTY/)
  const forwarded = await runProcess(command[0], [...command.slice(1), 'run', 'smoke'], {
    cwd: temporary,
    env,
    input: 'fixture stdin\n',
  })
  assert.equal(forwarded.exitCode, 7)
  assert.match(forwarded.stdout, /fixture stdin/)
  assert.match(forwarded.stderr, /fixture stderr/)

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
  assert.match(output, /\x1B\[\?1049h/, 'TUI must enter alternate screen')
  assert.match(output, /\x1B\[\?1049l/, 'TUI must restore normal screen on quit')
  if (process.platform !== 'win32')
    assert.deepEqual(await readdir(assetTemporary), [], 'Packaged processes must clean up native assets')
  process.stdout.write('Release smoke passed: checksum/archive, isolated help/version, TTY guard, real argv/stdin/output/exit forwarding, native TUI startup/quit, terminal and asset cleanup.\n')
}
finally {
  await rm(temporary, { recursive: true, force: true })
}
