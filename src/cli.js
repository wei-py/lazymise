import { stat } from 'node:fs/promises'
import process from 'node:process'
import packageJson from '../package.json' with { type: 'json' }
import { loadSnapshot, registry } from './mise.js'
import { runProcess } from './process.js'
import { updateRelease } from './release.js'

const HELP = `lazymise — mise TUI manager

Usage:
  lazymise [options]                 Start TUI in current directory
  lazymise [project-directory]       Start TUI in project directory
  lazymise <command> [args...]       Run CLI command

Commands:
  ls              List installed tools (mise ls)
  current         Show current tool versions (mise current)
  outdated        Show outdated tools (mise outdated)
  registry [q]    List tools from mise registry
  install <spec>  Install tool version (mise install --yes)
  uninstall <spec> Uninstall tool version (mise uninstall --yes)
  upgrade [...]   Upgrade tools (mise upgrade --yes)
  run <task>      Run a task (mise run)
  use <spec>      Install and set as default (mise use --yes)
  tasks           List available tasks (mise tasks)
  help [command]  Show mise help
  update          Self-update lazymise

  --help, -h      Show this help message
  --version, -v   Show lazymise version
`

/** Handle CLI arguments. Returns null to launch TUI, or an exit code. */
export async function runCli(args, { signal } = {}) {
  if (!args.length)
    return null

  const command = args[0]
  if (args.length === 1 && !command.startsWith('-')) {
    try {
      if ((await stat(command)).isDirectory())
        return null
    }
    catch {
      // A non-directory argument remains an ordinary mise subcommand.
    }
  }

  if (command === '--help' || command === '-h') {
    process.stdout.write(HELP)
    return 0
  }

  if (command === '--version' || command === '-v') {
    process.stdout.write(`lazymise ${packageJson.version}\n`)
    return 0
  }

  try {
    switch (command) {
      case 'ls':
        return await cmdList(args.slice(1))
      case 'current':
        return await passthrough(['current', ...args.slice(1)])
      case 'outdated':
        return await passthrough(['outdated', ...args.slice(1)])
      case 'registry':
        return await cmdRegistry(args.slice(1))
      case 'install':
        return args[1]
          ? await passthrough(['install', '--yes', ...args.slice(1)])
          : usage('install <spec>')
      case 'uninstall':
        return args[1]
          ? await passthrough(['uninstall', '--yes', ...args.slice(1)])
          : usage('uninstall <spec>')
      case 'upgrade':
        return await passthrough(['upgrade', '--yes', ...args.slice(1)])
      case 'run':
        return args[1] ? await passthrough(['run', ...args.slice(1)]) : usage('run <task>')
      case 'use':
        return args[1]
          ? await passthrough(['use', '--yes', ...args.slice(1)])
          : usage('use <spec>')
      case 'tasks':
        return await passthrough(['tasks', ...args.slice(1)])
      case 'help':
        return await passthrough(['help', ...args.slice(1)])
      case 'update':
        return await cmdUpdate(signal)
      default:
        // Unknown command — check if it matches a mise subcommand
        return await passthrough([command, ...args.slice(1)])
    }
  }
  catch (err) {
    process.stderr.write(`lazymise: ${err.message || err}\n`)
    return 1
  }
}

function usage(msg) {
  process.stderr.write(`Usage: lazymise ${msg}\n`)
  return 1
}

async function passthrough(args) {
  const result = await runProcess('mise', args, { inherit: true })
  return result.exitCode
}

async function cmdList(_args) {
  try {
    const snapshot = await loadSnapshot()
    for (const tool of snapshot.tools) {
      const marker = tool.active ? '●' : '○'
      const source = tool.source || ''
      process.stdout.write(
        `${marker} ${tool.name.padEnd(24)} ${tool.version.padEnd(12)} ${source}\n`,
      )
    }
    return 0
  }
  catch (err) {
    process.stderr.write(`lazymise: ${err.message || err}\n`)
    return 1
  }
}

async function cmdRegistry(args) {
  const query = args[0]
  try {
    const tools = await registry()
    const search = query ? query.toLowerCase() : ''
    for (const tool of tools) {
      if (
        !search
        || tool.name.toLowerCase().includes(search)
        || tool.description.toLowerCase().includes(search)
      ) {
        const backends = tool.backends.length ? `[${tool.backends.join(', ')}]` : ''
        process.stdout.write(`${tool.name.padEnd(24)} ${backends} ${tool.description}\n`)
      }
    }
    return 0
  }
  catch (err) {
    process.stderr.write(`lazymise: ${err.message || err}\n`)
    return 1
  }
}

async function cmdUpdate(signal) {
  const message = await updateRelease({ signal })
  signal?.throwIfAborted()
  process.stdout.write(`${message}\n`)
  return 0
}
