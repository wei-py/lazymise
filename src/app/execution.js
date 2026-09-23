import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
  try {
    copyToClipboard(readFileSync(config.path, 'utf8'))
    app.state.status = t(app.state.language, 'config_copied', { path: config.path })
  }
  catch (error) {
    app.state.status = t(app.state.language, 'config_copy_failed', {
      error: error.message || String(error),
    })
  }
  app.update()
}

function copyToClipboard(text) {
  const cmd
    = process.platform === 'darwin' ? 'pbcopy' : process.platform === 'linux' ? 'wl-copy' : 'clip'
  const proc = spawnSync(cmd, [], { input: text, timeout: 3000 })
  if (proc.status !== 0)
    throw new Error(proc.error?.message || proc.stderr?.toString() || 'clipboard unavailable')
}

export async function executeCommand(app, args, passthrough) {
  const cmdStr = args.join(' ')
  if (!passthrough && ['use', 'install', 'uninstall', 'upgrade'].includes(args[0])) {
    executeBackground(app, args, cmdStr)
    return
  }
  app.state.status = t(app.state.language, 'executing', { command: cmdStr })
  app.update()
  try {
    if (passthrough || isInteractive(args[0])) {
      const proc = Bun.spawn(['mise', ...args], {
        stdout: 'inherit',
        stderr: 'inherit',
        stdin: 'inherit',
      })
      const exitCode = await proc.exited
      finishCommand(app, { command: `mise ${cmdStr}`, output: '', success: exitCode === 0 })
    }
    else {
      finishCommand(app, await execute(args))
    }
  }
  catch (error) {
    finishCommand(app, {
      command: `mise ${cmdStr}`,
      output: error.message || String(error),
      success: false,
    })
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

export function executeBackground(app, args, label, onComplete = null) {
  const argv = [...args]
  const task = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    command: `mise ${argv.join(' ')}`,
    status: 'pending',
    output: '',
    startTime: Date.now(),
    endTime: 0,
  }
  const selection = captureSelection(app)
  app.state.consoleTasks.unshift(task)
  app.state.consoleTasks.length = Math.min(app.state.consoleTasks.length, 100)
  restoreSelection(app, selection)
  app.update()
  void (async () => {
    try {
      const proc = Bun.spawn(['mise', ...argv], { stdout: 'pipe', stderr: 'pipe' })
      task.status = 'running'
      app.update()
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      task.output = `${stdout}\n${stderr}`.trim()
      task.status = exitCode === 0 ? 'done' : 'failed'
    }
    catch (error) {
      task.output = error.message || String(error)
      task.status = 'failed'
    }
    task.endTime = Date.now()
    try {
      if (onComplete)
        await onComplete(task)
    }
    catch (error) {
      task.output = [task.output, error.message || String(error)].filter(Boolean).join('\n')
      task.status = 'failed'
    }
    finishCommand(app, {
      command: task.command,
      output: task.output,
      success: task.status === 'done',
    })
  })()
  return task
}
