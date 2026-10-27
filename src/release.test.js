import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { runProcess } from './process.js'
import { installLatestRelease, releaseTarget, replaceExecutable, updateRelease } from './release.js'

async function fixture(run, { checksumValid = true, candidateVersion = '2.0.0', holdDownload = false, holdProbe = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lazymise-updater-test-'))
  const target = releaseTarget('2.0.0')
  const executable = join(directory, 'installed-lazymise')
  const packageDirectory = join(directory, target.directory)
  const probeMarker = join(directory, 'probe-started')
  let downloadStarted
  const downloading = new Promise((resolve) => { downloadStarted = resolve })
  let server
  try {
    await writeFile(executable, 'original executable')
    await mkdir(packageDirectory)
    const candidate = `#!${process.execPath}\n${holdProbe ? `require('node:fs').writeFileSync(${JSON.stringify(probeMarker)}, 'ready');setTimeout(() => console.log('lazymise ${candidateVersion}'), 60000);` : `console.log('lazymise ${candidateVersion}');`}\n`
    await writeFile(join(packageDirectory, target.binaryName), candidate)
    await chmod(join(packageDirectory, target.binaryName), 0o755)
    const archivePath = join(directory, target.archiveName)
    assert.equal((await runProcess('tar', ['-a', '-cf', archivePath, '-C', directory, target.directory])).exitCode, 0)
    const archive = await readFile(archivePath)
    const digest = checksumValid ? createHash('sha256').update(archive).digest('hex') : '0'.repeat(64)
    const assetBase = 'https://github.com/wei-py/lazymise/releases/download/v2.0.0/'
    server = createServer((request, response) => {
      if (request.url === '/repos/wei-py/lazymise/releases/latest') {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ tag_name: 'v2.0.0', assets: [target.archiveName, 'SHA256SUMS'].map(name => ({ name, browser_download_url: assetBase + name })) }))
      }
      else if (request.url.endsWith('/SHA256SUMS')) {
        response.end(`${digest}  ${target.archiveName}\n`)
      }
      else if (request.url.endsWith(`/${target.archiveName}`)) {
        if (holdDownload) {
          response.setHeader('Content-Length', archive.length)
          response.write(archive.subarray(0, 1))
          downloadStarted()
        }
        else {
          response.end(archive)
        }
      }
      else { response.statusCode = 404; response.end() }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    const fetchRelease = (url, options) => fetch(new URL(new URL(url).pathname, origin), options)
    await run({ directory, executable, candidate, probeMarker, downloading, fetchRelease })
  }
  finally {
    server?.closeAllConnections()
    if (server)
      await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
}

const unixOnly = { skip: process.platform === 'win32', timeout: 15000 }

test('source self-update refuses replacement even when a signal is supplied', async () => {
  await assert.rejects(updateRelease({ signal: new AbortController().signal }), /Source checkout/)
})

test('updater verifies real streamed archives and replaces only the explicit executable', unixOnly, async () => {
  await fixture(async ({ directory, executable, candidate, fetchRelease }) => {
    const oldStage = join(directory, `.lazymise-${process.pid}.new`)
    const oldBackup = join(directory, `.lazymise-${process.pid}.backup`)
    await writeFile(oldStage, 'unrelated staged file')
    await writeFile(oldBackup, 'unrelated backup file')
    assert.match(await installLatestRelease({ executable, currentVersion: '1.0.0', fetchRelease }), /Updated.*2\.0\.0/)
    assert.equal(await readFile(executable, 'utf8'), candidate)
    assert.equal(await readFile(oldStage, 'utf8'), 'unrelated staged file')
    assert.equal(await readFile(oldBackup, 'utf8'), 'unrelated backup file')
  })
})

test('checksum and executable validation failures leave the installed file unchanged', unixOnly, async () => {
  for (const options of [{ checksumValid: false }, { candidateVersion: '9.9.9' }]) {
    await fixture(async ({ executable, fetchRelease }) => {
      await assert.rejects(installLatestRelease({ executable, currentVersion: '1.0.0', fetchRelease }), /checksum|version check/)
      assert.equal(await readFile(executable, 'utf8'), 'original executable')
    }, options)
  }
})

test('a disappeared staged executable rolls back the real filesystem rename', unixOnly, async () => {
  await fixture(async ({ directory, executable }) => {
    await assert.rejects(replaceExecutable(join(directory, 'disappeared-stage'), executable), /ENOENT/)
    assert.equal(await readFile(executable, 'utf8'), 'original executable')
  })
})

test('cancelling a streamed download aborts before any executable replacement', unixOnly, async () => {
  await fixture(async ({ executable, fetchRelease, downloading }) => {
    const controller = new AbortController()
    const pending = installLatestRelease({ executable, currentVersion: '1.0.0', fetchRelease, signal: controller.signal })
    const rejected = assert.rejects(pending, /cancelled download/)
    await downloading
    controller.abort(new Error('cancelled download'))
    await rejected
    assert.equal(await readFile(executable, 'utf8'), 'original executable')
  }, { holdDownload: true })
})

test('cancelling executable validation stops its real process and never commits', unixOnly, async () => {
  await fixture(async ({ executable, fetchRelease, probeMarker }) => {
    const controller = new AbortController()
    const pending = installLatestRelease({ executable, currentVersion: '1.0.0', fetchRelease, signal: controller.signal })
    const rejected = assert.rejects(pending, /cancelled probe/)
    const deadline = Date.now() + 5000
    while (!existsSync(probeMarker)) {
      assert.ok(Date.now() < deadline, 'candidate validation must start')
      await setTimeout(10)
    }
    controller.abort(new Error('cancelled probe'))
    await rejected
    assert.equal(await readFile(executable, 'utf8'), 'original executable')
  }, { holdProbe: true })
})

test('an already cancelled commit leaves both current and staged files in place', unixOnly, async () => {
  await fixture(async ({ directory, executable }) => {
    const staged = join(directory, 'verified-stage')
    await writeFile(staged, 'new executable')
    await assert.rejects(replaceExecutable(staged, executable, { signal: AbortSignal.abort(new Error('cancelled commit')) }), /cancelled commit/)
    assert.equal(await readFile(executable, 'utf8'), 'original executable')
    assert.equal(await readFile(staged, 'utf8'), 'new executable')
  })
})
