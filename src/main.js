#!/usr/bin/env bun
import { resolve } from 'node:path'
import process from 'node:process'
import { runCli } from './cli.js'
import { cancelProcesses, startProcess } from './process.js'

export function normalizeKey(key) {
  let name = key.name === 'return' ? 'enter' : key.name
  let text = ''
  if (!key.ctrl && !key.meta && !key.super && !key.hyper) {
    const printable = value => typeof value === 'string' && /^[^\p{Cc}\p{Cs}]$/u.test(value)
    if (printable(key.sequence))
      text = key.sequence
    else if (printable(name))
      text = key.shift && /^[a-z]$/.test(name) ? name.toUpperCase() : name
    if (text)
      name = text === ' ' ? 'space' : text
  }
  else if (/^[A-Z]$/.test(name)) {
    name = name.toLowerCase()
  }
  return { name, ctrl: key.ctrl, meta: key.meta, shift: key.shift, text, code: key.code }
}

export async function main(args = process.argv.slice(2)) {
  let cliSignal
  const cliAbort = new AbortController()
  const interruptCli = () => { cliSignal = 130; cliAbort.abort(); void cancelProcesses() }
  const terminateCli = () => { cliSignal = 143; cliAbort.abort(); void cancelProcesses() }
  process.on('SIGINT', interruptCli)
  process.on('SIGTERM', terminateCli)
  let cliResult
  try {
    cliResult = await runCli(args, { signal: cliAbort.signal })
  }
  finally {
    process.off('SIGINT', interruptCli)
    process.off('SIGTERM', terminateCli)
  }
  if (cliSignal)
    return cliSignal
  if (cliResult !== null)
    return cliResult
  if (args.length > 1 || args.some(arg => arg.startsWith('-'))) {
    process.stderr.write(
      'Usage: lazymise [project-directory]\nRun lazymise --help for all commands.\n',
    )
    return 1
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      'lazymise requires interactive stdin and stdout TTYs. Run it directly in a terminal.\n',
    )
    return 1
  }

  const projectDir = resolve(args[0] || process.cwd())
  process.chdir(projectDir)

  let renderer
  let app
  let cleanup
  let resolveExit
  let handoff
  const done = new Promise((resolveDone) => {
    resolveExit = resolveDone
  })

  const finish = (code, message) => {
    if (cleanup)
      return cleanup
    cleanup = (async () => {
      const results = await Promise.allSettled([app?.close?.(), cancelProcesses()])
      renderer?.destroy()
      if (results.some(result => result.status === 'rejected')) {
        code = code || 1
        message ||= 'Some background tasks could not be stopped cleanly.'
      }
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
      process.off('uncaughtException', onFailure)
      process.off('unhandledRejection', onFailure)
      if (message)
        process.stderr.write(`lazymise: ${message}\n`)
      resolveExit(code)
    })()
    return cleanup
  }

  function onSigint() {
    finish(130)
  }
  function onSigterm() {
    finish(143)
  }
  function onFailure() {
    finish(1, 'Unexpected runtime failure. Terminal restored.')
  }

  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)
  process.on('uncaughtException', onFailure)
  process.on('unhandledRejection', onFailure)

  try {
    const [{ createCliRenderer }, { Application }, { createView }] = await Promise.all([
      import('@opentui/core'),
      import('./app/controller.js'),
      import('./app/view.js'),
    ])
    if (cleanup)
      return await done

    renderer = await createCliRenderer({
      exitOnCtrlC: false,
      exitSignals: [],
      useMouse: false,
      consoleMode: 'disabled',
      openConsoleOnError: false,
      screenMode: 'alternate-screen',
      clearOnShutdown: true,
    })
    if (cleanup) {
      renderer.destroy()
      return await done
    }

    const view = createView(renderer)
    app = new Application(view, code => finish(code))
    app.handoff = async (commandArgs) => {
      renderer.suspend()
      try {
        handoff = startProcess('mise', commandArgs, { inherit: true })
        return await handoff.completion
      }
      finally {
        handoff = null
        if (!cleanup)
          renderer.resume()
      }
    }
    renderer.on('resize', () => app.update())
    renderer.on('render:error', onFailure)
    renderer.on('handler:error', onFailure)
    renderer.keyInput.on('keypress', (key) => {
      if (key.eventType === 'release')
        return
      key.preventDefault()
      app.handleKey(normalizeKey(key))
    })

    app.update()
    await app.start()
  }
  catch {
    await finish(
      1,
      'Unable to start lazymise. Check that mise is installed and your terminal supports OpenTUI.',
    )
  }

  return await done
}

if (import.meta.main) {
  const code = await main()
  process.exitCode = code
}
