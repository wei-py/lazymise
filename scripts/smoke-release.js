import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
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
  await execFile(process.execPath, ['build', '--compile', fixtureSource, '--outfile', fixtureBinary])
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

  for (const [name, executable, args] of [
    ['Source', process.execPath, [join(root, 'src/main.js')]],
    ['Release', command[0], command.slice(1)],
  ]) {
    let output = ''
    let closing = false
    let terminalClosed
    const drained = new Promise((resolve) => { terminalClosed = resolve })
    const child = Bun.spawn([executable, ...args], {
      cwd: temporary,
      env,
      terminal: {
        cols: 120,
        rows: 40,
        data(terminal, data) {
          output += Buffer.from(data).toString()
          if (!closing && /LAZYMISE|Tools/.test(output)) {
            closing = true
            setTimeout(() => terminal.write('q'), 150)
          }
        },
        exit: () => terminalClosed(),
      },
    })
    let timer
    try {
      const exitCode = await Promise.race([
        child.exited.then(async (code) => { await drained; return code }),
        new Promise((_, reject) => {
          timer = setTimeout(() => { child.kill(); reject(new Error(`${name} TUI timed out: ${output}`)) }, 20000)
        }),
      ])
      assert.ok(closing, `${name} TUI never rendered: ${output}`)
      assert.equal(exitCode, 0, output)
      assert.match(output, /\x1B\[\?1049h/, `${name} TUI must enter alternate screen:\n${output}`)
      assert.match(output, /\x1B\[\?1049l/, `${name} TUI must restore normal screen on quit:\n${output}`)
    }
    finally {
      clearTimeout(timer)
      child.terminal.close()
    }
  }
  process.stdout.write('Local smoke passed: checksum/archive, isolated release help/version, TTY guard, real argv/stdin/output/exit forwarding, source and extracted-release native TUI startup/quit, terminal restoration.\n')
}
finally {
  await rm(temporary, { recursive: true, force: true })
}
