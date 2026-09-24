import { readFile } from 'node:fs/promises'
import { t } from '../config/i18n.js'
import { execute, isInteractive } from '../mise.js'
import { captureSelection, restoreSelection } from './selection.js'

export function copySelectedConfig(app) {
  const config = app.selectedConfig()
  if (!config) {
    app.state.status = t(app.state.language, 'no_config_selected')
    app.update()
    return
  }
  const { path } = config
  void app.runner
    .submit({
      kind: 'copy',
      label: `copy ${path}`,
      run: async (api) => {
        api.setLast(path)
        await copyToClipboard(await readFile(path, 'utf8'))
      },
    })
    .then((job) => {
      app.state.status
        = job.state === 'done'
          ? t(app.state.language, 'config_copied', { path })
          : t(app.state.language, 'config_copy_failed', {
              error: job.lastLine || t(app.state.language, 'unknown_error'),
            })
      app.update()
    })
}

async function copyToClipboard(text) {
  const cmd
    = process.platform === 'darwin' ? 'pbcopy' : process.platform === 'linux' ? 'wl-copy' : 'clip'
  const proc = Bun.spawn([cmd], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  proc.stdin.write(text)
  proc.stdin.end()
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
    new Response(proc.stdout).text(),
  ])
  if (exitCode !== 0)
    throw new Error(stderr.trim() || `clipboard exited with code ${exitCode}`)
}

export async function executeCommand(app, args, passthrough) {
  const cmdStr = args.join(' ')
  if (!passthrough && ['use', 'install', 'uninstall', 'upgrade'].includes(args[0])) {
    executeBackground(app, args, cmdStr)
    return
  }
  if (passthrough || isInteractive(args[0])) {
    noticeHandoff(app, args)
    return
  }
  app.state.status = t(app.state.language, 'executing', { command: cmdStr })
  app.update()
  try {
    finishCommand(app, await execute(args))
  }
  catch (error) {
    finishCommand(app, {
      command: `mise ${cmdStr}`,
      output: error.message || String(error),
      success: false,
    })
  }
}

// Terminal handoff is the one path that waits on a child: announce it first.
function noticeHandoff(app, args) {
  app.state.overlay = {
    type: 'ConfirmCommand',
    parent: null,
    scroll: 0,
    message: t(app.state.language, 'handoff_notice', { cmd: `mise ${args.join(' ')}` }),
    onConfirm: () => void runHandoff(app, args),
  }
  app.update()
}

async function runHandoff(app, args) {
  const command = `mise ${args.join(' ')}`
  try {
    const proc = Bun.spawn(['mise', ...args], {
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'inherit',
    })
    const exitCode = await proc.exited
    finishCommand(app, { command, output: '', success: exitCode === 0 })
  }
  catch (error) {
    finishCommand(app, { command, output: error.message || String(error), success: false })
  }
}

function finishCommand(app, result) {
  const selection = captureSelection(app)
  app.state.logs.unshift({
    command: result.command || '',
    output: result.output || '',
    success: result.success !== false,
  })
  app.state.logs.length = Math.min(app.state.logs.length, 100)
  restoreSelection(app, selection)
  app.state.status = result.success
    ? t(app.state.language, 'command_success')
    : t(app.state.language, 'command_failed', {
        error: result.output || t(app.state.language, 'unknown_error'),
      })
  app.update()
  if (result.success)
    void app.refresh()
}

/**
 * Queue one serialized mise mutation. The returned promise resolves with the
 * settled job after the console log and status line are written; it never
 * rejects, so key handlers can fire-and-forget it.
 */
export function executeBackground(app, args, label, onComplete = null) {
  const command = `mise ${args.join(' ')}`
  return app.runner
    .submit({ kind: 'mise', label, cmd: ['mise', ...args], serialized: true })
    .then(async (job) => {
      let output = job.lastLine
      let success = job.state === 'done'
      if (job.state === 'canceled') {
        const seconds = `${Math.max(
          1,
          Math.round((job.endedAt - (job.startedAt ?? job.endedAt)) / 1000),
        )}s`
        output = t(app.state.language, 'canceled · {seconds}', { seconds })
      }
      if (onComplete) {
        try {
          await onComplete(job)
        }
        catch (error) {
          output = [output, error.message || String(error)].filter(Boolean).join('\n')
          success = false
        }
      }
      finishCommand(app, { command, output, success })
      return job
    })
}
