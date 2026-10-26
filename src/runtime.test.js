import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '../support/node-test.js'
import { createJobRunner } from '../vendor/lazy-kit/jobs.js'
import { runProcess, startProcess } from './process.js'
import { releaseTarget } from './release.js'

const main = join(import.meta.dirname, 'main.js')

test('Node CLI help/version bypass native FFI; non-TTY launch and missing mise fail clearly', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'lazymise-cli-'))
  const env = { ...process.env, PATH: temporary, HOME: temporary, LAZYMISE_CONFIG_DIR: temporary }
  try {
    const help = await runProcess(process.execPath, [main, '--help'], { env, cwd: temporary })
    assert.equal(help.exitCode, 0)
    assert.match(help.stdout, /Usage:/)
    assert.doesNotMatch(help.stderr, /ffi|OpenTUI/i)
    const version = await runProcess(process.execPath, [main, '--version'], { env, cwd: temporary })
    assert.equal(version.exitCode, 0)
    assert.match(version.stdout, /^lazymise \d+\.\d+\.\d+/)
    const guard = await runProcess(process.execPath, [main], { env, cwd: temporary })
    assert.equal(guard.exitCode, 1)
    assert.match(guard.stderr, /TTY/)
    const missing = await runProcess(process.execPath, [main, 'run', 'fixture'], { env, cwd: temporary })
    assert.equal(missing.exitCode, 1)
    assert.match(missing.stderr, /ENOENT|not found/)
    const sourceUpdate = await runProcess(process.execPath, [main, 'update'], { env, cwd: temporary })
    assert.equal(sourceUpdate.exitCode, 1)
    assert.match(sourceUpdate.stderr, /Source checkout/)
  }
  finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('child execution preserves stdin, both output channels, and nonzero status', async () => {
  const result = await runProcess(process.execPath, ['--input-type=module', '--eval', `
    for await (const chunk of process.stdin) process.stdout.write(chunk);
    process.stderr.write('rejected\\n'); process.exitCode = 23;
  `], { input: '中文 input\n' })
  assert.equal(result.exitCode, 23)
  assert.equal(result.stdout, '中文 input\n')
  assert.equal(result.stderr, 'rejected\n')
  await assert.rejects(runProcess(join(tmpdir(), 'missing-lazymise-command'), []), { code: 'ENOENT' })
})

test('jobs drain output, preserve errors, and serialize after cancellation', async () => {
  let ready
  const started = new Promise((resolve) => { ready = resolve })
  const runner = createJobRunner({ onPatch: (job) => {
    if (job.lastLine === 'ready')
      ready(job.id)
  } })
  const first = runner.submit({ cmd: [process.execPath, '--eval', 'console.log(\'ready\');setInterval(()=>{},1000)'], serialized: true })
  const second = runner.submit({ cmd: [process.execPath, '--eval', 'process.stdout.write(\'last line\');process.stderr.write(\'failure line\');process.exitCode=9'], serialized: true })
  const id = await started
  assert.equal(runner.list()[1].state, 'queued')
  assert.equal(runner.abort(id), true)
  assert.equal((await first).state, 'canceled')
  const failed = await second
  assert.equal(failed.state, 'failed')
  assert.equal(failed.exitCode, 9)
  assert.ok(runner.log().includes('last line'))
  assert.ok(runner.log().includes('failure line'))
  assert.match(failed.output, /last line/)
  assert.match(failed.output, /failure line/)
  const missing = await runner.submit({ cmd: [join(tmpdir(), 'missing-lazymise-job')] })
  assert.equal(missing.state, 'failed')
  assert.match(missing.lastLine, /ENOENT/)
  await runner.abortAll()
})

test('cancel waits for the real process to exit and retains signal status', async () => {
  let ready
  const started = new Promise((resolve) => { ready = resolve })
  const child = startProcess(process.execPath, ['--eval', 'console.log(\'ready\');setInterval(()=>{},1000)'], {
    onOutput: () => ready(),
  })
  await started
  const result = await child.cancel()
  assert.notEqual(result.exitCode, 0)
  assert.throws(() => process.kill(child.child.pid, 0), { code: 'ESRCH' })
})

test('release archives retain their versioned historical install layout', () => {
  assert.deepEqual(releaseTarget('1.2.3', 'darwin', 'arm64'), {
    slug: 'macos-aarch64',
    directory: 'lazymise-v1.2.3-macos-aarch64',
    archiveName: 'lazymise-v1.2.3-macos-aarch64.tar.gz',
    binaryName: 'lazymise',
    nativePackage: '@opentui/core-darwin-arm64',
  })
  assert.equal(releaseTarget('1.2.3', 'win32', 'x64').archiveName, 'lazymise-v1.2.3-windows-x86_64.zip')
  assert.throws(() => releaseTarget('1.2.3', 'freebsd', 'x64'), /Unsupported/)
})
