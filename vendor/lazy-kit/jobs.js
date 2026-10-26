import { startProcess } from '../../src/process.js'

/** Serialized background jobs with streamed output and process-group cancellation. */

export const JOB_GLYPH = {
  queued: '·',
  running: '▶',
  done: '✓',
  failed: '✗',
  canceled: '⊘',
}

const ANSI_RE = /\x1B\[[0-9;]*[a-z]/gi
const LOG_LIMIT = 200
const OUTPUT_LIMIT = 256 * 1024

// One process-wide chain: every runner shares the serialized queue.
let chain = Promise.resolve()

function linePump(onLine) {
  let carry = ''
  return {
    write(chunk) {
      carry += chunk.replace(ANSI_RE, '')
      const parts = carry.split(/\r\n|\r|\n/)
      carry = parts.pop() ?? ''
      for (const part of parts) onLine(part)
    },
    end() {
      if (carry)
        onLine(carry)
    },
  }
}

export function createJobRunner({ onPatch = () => {} } = {}) {
  const jobs = []
  const logs = []
  const killers = new Map()
  const processes = new Set()
  let seq = 0

  function log(line) {
    logs.push(line)
    if (logs.length > LOG_LIMIT)
      logs.shift()
  }

  async function spawn(job, op) {
    const onLine = (line) => {
      job.lastLine = line
      job.output = `${job.output}${line}\n`
      if (job.output.length > OUTPUT_LIMIT)
        job.output = `[earlier output truncated]\n${job.output.slice(-OUTPUT_LIMIT)}`
      log(line)
      onPatch(job)
    }
    const stdout = linePump(onLine)
    const stderr = linePump(onLine)
    const proc = startProcess(op.cmd[0], op.cmd.slice(1), {
      env: op.env ? { ...process.env, ...op.env } : undefined,
      onOutput: (chunk, channel) => (channel === 'stdout' ? stdout : stderr).write(chunk),
    })
    killers.set(job.id, () => { void proc.cancel().catch(() => {}) })
    processes.add(proc.completion)
    try {
      const { exitCode } = await proc.completion
      return exitCode
    }
    finally {
      stdout.end()
      stderr.end()
      processes.delete(proc.completion)
    }
  }

  async function runFunction(job, op) {
    const controller = new AbortController()
    killers.set(job.id, () => controller.abort())
    const api = {
      signal: controller.signal,
      setLast(line) {
        job.lastLine = String(line)
        log(job.lastLine)
        onPatch(job)
      },
      log(line) {
        log(String(line))
      },
    }
    await op.run(api)
    return 0
  }

  async function execute(job, op) {
    if (job.state === 'canceled')
      return job
    job.state = 'running'
    job.startedAt = Date.now()
    onPatch(job)
    try {
      const code = op.cmd ? await spawn(job, op) : await runFunction(job, op)
      job.exitCode = code
      if (job.state === 'canceled')
        return job
      job.state = code === 0 ? 'done' : 'failed'
      if (code !== 0 && !job.lastLine)
        job.lastLine = `process exited with code ${code}`
      job.endedAt = Date.now()
      log(`exit ${code}`)
    }
    catch (error) {
      if (job.state === 'canceled')
        return job
      const message = error instanceof Error ? error.message : String(error)
      job.state = 'failed'
      job.exitCode = null
      job.endedAt = Date.now()
      job.lastLine = message
      log(`error: ${message}`)
    }
    finally {
      killers.delete(job.id)
      onPatch(job)
    }
    return job
  }

  /**
   * Queue one job: `op.cmd` (argv array) runs as a child process, `op.run`
   * receives `{ setLast, log, signal }` — exactly one of the two is required.
   * `serialized: true` waits for earlier serialized jobs (`queued` state).
   * Resolves with the settled job and never rejects, so callers can chain
   * refreshes without blocking the key handler.
   */
  function submit(op) {
    const hasCmd = op != null && op.cmd != null
    const hasRun = op != null && op.run != null
    if (hasCmd === hasRun)
      throw new TypeError('job op requires exactly one of cmd or run')
    if (hasCmd && !Array.isArray(op.cmd))
      throw new TypeError('job op cmd must be an argv array')
    if (hasRun && typeof op.run !== 'function')
      throw new TypeError('job op run must be a function')
    seq += 1
    const job = {
      id: seq,
      kind: op.kind ?? 'task',
      label: op.label ?? '',
      state: 'queued',
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastLine: '',
      output: '',
    }
    jobs.push(job)
    log(`$ ${hasCmd ? op.cmd.join(' ') : job.label}`)
    onPatch(job)
    if (op.serialized) {
      job.lastLine = 'waiting for other jobs'
      const settled = chain.then(() => execute(job, op))
      chain = settled.then(() => {}, () => {})
      return settled
    }
    return execute(job, op)
  }

  /** Settle one queued/running job as canceled; settled jobs are a no-op. */
  function abort(id) {
    const job = jobs.find(candidate => candidate.id === id)
    if (!job || (job.state !== 'queued' && job.state !== 'running'))
      return false
    job.state = 'canceled'
    job.endedAt = Date.now()
    const kill = killers.get(id)
    killers.delete(id)
    if (kill)
      kill()
    log('canceled')
    onPatch(job)
    return true
  }

  async function abortAll() {
    for (const job of [...jobs])
      abort(job.id)
    await Promise.allSettled([...processes])
  }

  return {
    submit,
    abort,
    abortAll,
    list: () => jobs,
    log: () => [...logs],
  }
}
