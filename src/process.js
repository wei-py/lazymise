import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { join } from 'node:path'

const activeProcesses = new Set()

export async function cancelProcesses() {
  await Promise.allSettled([...activeProcesses].map(operation => operation.cancel()))
}

/** Start an argv-only child; completion waits for exit and drained output. */
export function startProcess(command, args = [], { input, inherit = false, env, cwd, onOutput, signal } = {}) {
  const grouped = !inherit && process.platform !== 'win32'
  const child = spawn(command, args, {
    cwd,
    env,
    detached: grouped,
    stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    windowsHide: !inherit,
  })
  let stdout = ''
  let stderr = ''
  let failure
  if (!inherit) {
    for (const [stream, channel] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      stream.setEncoding('utf8')
      stream.on('data', (chunk) => {
        if (onOutput)
          onOutput(chunk, channel)
        else if (channel === 'stdout')
          stdout += chunk
        else stderr += chunk
      })
      stream.on('error', (error) => { failure ??= error })
    }
    child.stdin.on('error', (error) => { failure ??= error })
    child.stdin.end(input)
  }
  const completion = new Promise((resolve, reject) => {
    child.on('error', (error) => { failure ??= error })
    child.on('close', (code, signal) => {
      if (failure) {
        failure.stdout = stdout
        failure.stderr = stderr
        if (stderr.trim())
          failure.message += `: ${stderr.trim()}`
        reject(failure)
      }
      else {
        resolve({ stdout, stderr, signal, exitCode: code ?? 128 + (constants.signals[signal] ?? 1) })
      }
    })
  })
  let escalation
  completion.finally(() => clearTimeout(escalation)).catch(() => {})
  function signalChild(signal) {
    try {
      if (process.platform === 'win32' && child.pid) {
        const taskkill = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), [
          '/pid',
          String(child.pid),
          '/T',
          '/F',
        ], { stdio: 'ignore', windowsHide: true })
        taskkill.on('error', () => child.kill(signal))
        return
      }
      if (grouped && child.pid)
        process.kill(-child.pid, signal)
      else child.kill(signal)
    }
    catch (error) {
      if (error.code !== 'ESRCH')
        throw error
    }
  }
  const operation = {
    child,
    completion,
    cancel() {
      signalChild('SIGTERM')
      escalation ??= setTimeout(signalChild, 1500, 'SIGKILL')
      escalation.unref()
      return completion
    },
  }
  activeProcesses.add(operation)
  completion.finally(() => activeProcesses.delete(operation)).catch(() => {})
  const onAbort = () => { void operation.cancel().catch(() => {}) }
  signal?.addEventListener('abort', onAbort, { once: true })
  completion.finally(() => signal?.removeEventListener('abort', onAbort)).catch(() => {})
  if (signal?.aborted)
    onAbort()
  return operation
}

export function runProcess(command, args, options) {
  return startProcess(command, args, options).completion
}
