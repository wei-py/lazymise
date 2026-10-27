import { createHash } from 'node:crypto'
import { chmod, copyFile, lstat, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import packageJson from '../package.json' with { type: 'json' }
import { runProcess } from './process.js'

export const RELEASE_REPOSITORY = 'wei-py/lazymise'

/** Archive layout is versioned and keeps the historical root-level binary. */
export function releaseTarget(version = packageJson.version, platform = process.platform, arch = process.arch) {
  if (!['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'].includes(`${platform}-${arch}`))
    throw new Error(`Unsupported release target: ${platform}-${arch}`)
  if (platform === 'linux' && process.env.OPENTUI_LIBC === 'musl')
    throw new Error('Official releases require glibc. Build from source for musl.')
  const slug = `${platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : platform}-${arch === 'x64' ? 'x86_64' : 'aarch64'}`
  const directory = `lazymise-v${version}-${slug}`
  return {
    slug,
    directory,
    archiveName: `${directory}.${platform === 'win32' ? 'zip' : 'tar.gz'}`,
    binaryName: platform === 'win32' ? 'lazymise.exe' : 'lazymise',
    nativePackage: `@opentui/core-${platform}-${arch}`,
  }
}

async function response(url, { signal, fetchRelease }) {
  signal?.throwIfAborted()
  const requestSignal = AbortSignal.any([
    ...(signal ? [signal] : []),
    AbortSignal.timeout(60000),
  ])
  const result = await fetchRelease(url, {
    headers: { 'User-Agent': 'lazymise', 'Accept': 'application/vnd.github+json' },
    signal: requestSignal,
  })
  if (!result.ok)
    throw new Error(`Download failed (${result.status}): ${url}`)
  return result
}

/**
 * Commit a verified, same-filesystem staged executable. A failed or cancelled
 * commit restores the previous file. Failed recovery always retains its backup.
 */
export async function replaceExecutable(staged, executable, { signal } = {}) {
  signal?.throwIfAborted()
  const transaction = await mkdtemp(join(dirname(executable), '.lazymise-rollback-'))
  const backup = join(transaction, 'previous-executable')
  let moved = false
  let committed = false
  let failure
  let recoveryFailed = false
  try {
    signal?.throwIfAborted()
    await rename(executable, backup)
    moved = true
    signal?.throwIfAborted()
    await rename(staged, executable)
    committed = true
    signal?.throwIfAborted()
  }
  catch (error) {
    failure = error
    if (moved) {
      try {
        await rename(backup, executable)
        committed = false
      }
      catch (rollbackError) {
        // If rename recovery is unavailable, copying the retained original is
        // still preferable to leaving the installed path missing.
        try {
          await copyFile(backup, executable)
          committed = false
        }
        catch (copyError) {
          recoveryFailed = true
          failure = new AggregateError([error, rollbackError, copyError], `Update failed and automatic rollback failed. Original executable retained at ${backup}.`)
        }
      }
    }
  }
  if (recoveryFailed)
    throw failure
  try {
    await rm(transaction, { recursive: true, force: true })
  }
  catch (error) {
    // Windows may lock the displaced running executable until this process exits.
    if (!failure && committed && process.platform === 'win32'
      && ['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) {
      return { retainedBackup: backup }
    }
    if (failure)
      throw new AggregateError([failure, error], `Update failed; rollback completed, but cleanup failed: ${transaction}`)
    throw new Error(`Executable updated, but backup cleanup failed: ${transaction}`, { cause: error })
  }
  if (failure)
    throw failure
  return { retainedBackup: null }
}

/** Install into an explicit executable path using a fetch-compatible transport. */
export async function installLatestRelease({
  executable,
  currentVersion,
  signal,
  fetchRelease = fetch,
}) {
  const transport = { signal, fetchRelease }
  signal?.throwIfAborted()
  const release = await (await response(`https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`, transport)).json()
  signal?.throwIfAborted()
  const version = /^v(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1]
  if (!version)
    throw new Error('Latest release has an invalid version tag.')
  if (version === currentVersion)
    return `Already up to date (v${version}).`
  const target = releaseTarget(version)
  const asset = (name) => {
    const url = release.assets?.find(item => item.name === name)?.browser_download_url
    if (!url || !url.startsWith(`https://github.com/${RELEASE_REPOSITORY}/releases/download/`))
      throw new Error(`Missing official release asset: ${name}`)
    return url
  }
  const temporary = await mkdtemp(join(tmpdir(), 'lazymise-update-'))
  let staging
  let failure
  let result
  try {
    const archive = join(temporary, target.archiveName)
    const data = new Uint8Array(await (await response(asset(target.archiveName), transport)).arrayBuffer())
    signal?.throwIfAborted()
    const checksums = await (await response(asset('SHA256SUMS'), transport)).text()
    signal?.throwIfAborted()
    const expected = checksums.split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(parts => parts[1]?.replace(/^\*/, '') === target.archiveName)?.[0]
    if (!expected || createHash('sha256').update(data).digest('hex') !== expected)
      throw new Error('Release checksum verification failed; current executable is unchanged.')
    await writeFile(archive, data, { signal })
    const extracted = await runProcess('tar', ['-xf', archive, '-C', temporary], { signal })
    signal?.throwIfAborted()
    if (extracted.exitCode !== 0)
      throw new Error(extracted.stderr || 'Unable to extract release archive.')
    const candidate = join(temporary, target.directory, target.binaryName)
    if (!(await lstat(candidate)).isFile())
      throw new Error('Release archive does not contain a regular executable.')
    await chmod(candidate, 0o755)
    const probeSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)])
    const probe = await runProcess(candidate, ['--version'], { signal: probeSignal })
    probeSignal.throwIfAborted()
    if (probe.exitCode !== 0 || probe.stdout.trim() !== `lazymise ${version}`)
      throw new Error('Downloaded executable failed its version check; current executable is unchanged.')
    signal?.throwIfAborted()
    staging = await mkdtemp(join(dirname(executable), '.lazymise-update-'))
    const staged = join(staging, target.binaryName)
    await copyFile(candidate, staged)
    await chmod(staged, 0o755)
    signal?.throwIfAborted()
    const { retainedBackup } = await replaceExecutable(staged, executable, { signal })
    result = `Updated lazymise to v${version}.${retainedBackup ? ` Previous executable retained at ${retainedBackup}; remove it after this process exits.` : ''}`
  }
  catch (error) {
    failure = signal?.aborted && error.name === 'AbortError' ? signal.reason : error
  }
  finally {
    const cleanup = await Promise.allSettled([
      ...(staging ? [rm(staging, { recursive: true, force: true })] : []),
      rm(temporary, { recursive: true, force: true }),
    ])
    const errors = cleanup.filter(result => result.status === 'rejected').map(result => result.reason)
    if (errors.length) {
      failure = new AggregateError([...(failure ? [failure] : []), ...errors], failure ? 'Update failed; temporary cleanup also failed.' : 'Executable updated, but temporary cleanup failed.')
    }
  }
  if (failure)
    throw failure
  return result
}

/** Only a compiled release may replace itself; source never replaces Bun. */
export async function updateRelease({ signal } = {}) {
  if (typeof LAZYMISE_STANDALONE === 'undefined' || !LAZYMISE_STANDALONE)
    throw new Error('Source checkout: update with git pull and bun install --frozen-lockfile. Self-update is only available in standalone releases.')
  return await installLatestRelease({
    executable: process.execPath,
    currentVersion: packageJson.version,
    signal,
  })
}
