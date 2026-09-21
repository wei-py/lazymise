import { $ } from 'bun'

async function miseJson(args) {
  const result = await $`mise ${args}`.quiet()
  const out = result.stdout.toString().trim()
  if (result.exitCode !== 0) {
    const err = result.stderr.toString().trim()
    throw new Error(`mise ${args.join(' ')} failed: ${err || out}`)
  }
  try { return JSON.parse(out) }
  catch { return out }
}

async function miseText(args) {
  const result = await $`mise ${args}`.quiet()
  const out = result.stdout.toString().trim()
  if (result.exitCode !== 0) {
    const err = result.stderr.toString().trim()
    throw new Error(`mise ${args.join(' ')} failed: ${err || out}`)
  }
  return out
}

/** Load complete snapshot: tools, updates, tasks, configs. */
export async function loadSnapshot() {
  const [version, tools, updates, tasks, configs] = await Promise.all([
    miseText(['--version']),
    loadTools(),
    loadUpdates(),
    loadTasks(),
    loadConfigs(),
  ])
  return {
    mise_version: version.split(' ')[0] || '—',
    tools,
    updates,
    tasks,
    configs,
  }
}

async function loadTools() {
  try {
    const entries = await miseJson(['ls', '--json'])
    if (!Array.isArray(entries))
      return []
    return entries.map(e => ({
      name: e.name || e.tool || '',
      version: e.version || '',
      requested: e.requested_version || '',
      source: e.source?.path || null,
      installed: e.installed === true,
      active: e.active === true,
    }))
  }
  catch { return [] }
}

async function loadUpdates() {
  try {
    const entries = await miseJson(['outdated', '--json'])
    if (!Array.isArray(entries))
      return []
    return entries.map(e => ({
      name: e.name || '',
      current: e.current || e.version || '',
      latest: e.latest || '',
    }))
  }
  catch { return [] }
}

async function loadTasks() {
  try {
    const entries = await miseJson(['tasks', '--json'])
    if (!Array.isArray(entries))
      return []
    return entries.map(e => ({
      name: e.name || '',
      description: e.description || '',
      command: Array.isArray(e.run)
        ? e.run.join(' ')
        : (e.run || e.command || ''),
    }))
  }
  catch { return [] }
}

async function loadConfigs() {
  try {
    const entries = await miseJson(['config', 'ls', '--json'])
    if (!Array.isArray(entries))
      return []
    return entries.map(e => ({
      path: e.path || '',
      tools: e.tools || [],
    }))
  }
  catch { return [] }
}

/** Fetch mise registry (all known tools with backends). */
export async function registry() {
  try {
    const entries = await miseJson(['registry', '--json'])
    if (!Array.isArray(entries))
      return []
    return entries.map(e => ({
      name: e.short || e.name || '',
      description: e.description || '',
      backends: e.backends || [],
    }))
  }
  catch { return [] }
}

/** Fetch remote versions for a tool (full backend identifier like npm:package). */
export async function remoteVersions(tool) {
  try {
    const entries = await miseJson(['ls-remote', tool, '--json'])
    if (!Array.isArray(entries))
      return []
    return entries
      .map(e => ({
        version: e.version || '',
        created_at: e.created_at || e.released || '',
      }))
      .sort((a, b) => b.version.localeCompare(a.version, void 0, { numeric: true }))
  }
  catch { return [] }
}

/** Execute arbitrary mise subcommand; returns output struct. */
export async function execute(args) {
  const command = `mise ${args.join(' ')}`
  try {
    const result = await $`mise ${args}`.quiet()
    return {
      command,
      output: result.stdout.toString(),
      success: result.exitCode === 0,
    }
  }
  catch (err) {
    return {
      command,
      output: err.stderr?.toString() || err.message || String(err),
      success: false,
    }
  }
}

/** Parse mise -h into CommandSpec list. */
export async function commandCatalog() {
  try {
    const help = await miseText(['-h'])
    return parseCommandCatalog(help)
  }
  catch { return [] }
}

function parseCommandCatalog(help) {
  const commands = []
  const lines = help.split('\n')
  for (const line of lines) {
    const match = line.match(/^\s{2}(\S[^ ]{1,40})\s{2,}(.+)$/)
    if (match) {
      commands.push({ name: match[1].trim(), description: match[2].trim() })
    }
  }
  return commands
}

/** Get help text for a specific mise subcommand. */
export async function commandHelp(command) {
  try {
    return await miseText([command, '-h'])
  }
  catch (err) {
    return `No help available: ${err.message || err}`
  }
}

// Command groupings (ported from Rust lazymise)
export const TOOL_COMMANDS = [
  'backends', 'install', 'install-into', 'latest', 'link', 'ls', 'ls-remote',
  'plugins', 'prune', 'registry', 'reshim', 'search', 'sync', 'test-tool',
  'tool', 'tool-alias', 'tool-stub', 'uninstall', 'unuse', 'use', 'where',
]
export const UPDATE_COMMANDS = ['outdated', 'prune', 'upgrade']
export const TASK_COMMANDS = ['deps', 'run', 'tasks', 'watch']
export const ENVIRONMENT_COMMANDS = [
  'activate', 'bin-paths', 'deactivate', 'en', 'env', 'exec',
  'shell', 'shell-alias', 'which',
]
export const CONFIG_COMMANDS = [
  'config', 'edit', 'fmt', 'lock', 'set', 'settings', 'trust', 'unset', 'untrust',
]
export const SYSTEM_COMMANDS = [
  'bootstrap', 'cache', 'completion', 'doctor', 'generate', 'help',
  'implode', 'mcp', 'oci', 'patrons', 'self-update', 'sponsors', 'token', 'version',
]
export const DASHBOARD_COMMANDS = ['bootstrap', 'doctor', 'help', 'self-update', 'version']

const PAGE_COMMANDS = {
  Dashboard: DASHBOARD_COMMANDS,
  Tools: TOOL_COMMANDS,
  Updates: UPDATE_COMMANDS,
  Tasks: TASK_COMMANDS,
  Environment: ENVIRONMENT_COMMANDS,
  Config: CONFIG_COMMANDS,
  System: SYSTEM_COMMANDS,
}

/** Check if a command belongs to a page (for context commands). */
export function commandBelongsToPage(page, commandName) {
  const cmds = PAGE_COMMANDS[page]
  return cmds ? cmds.includes(commandName) : false
}

/** Commands requiring confirmation before execution. */
const CONFIRM_COMMANDS = new Set([
  'cache', 'config', 'implode', 'prune', 'self-update',
  'sync', 'uninstall', 'unset', 'untrust', 'unuse',
])

export function needsConfirmation(commandName) {
  return CONFIRM_COMMANDS.has(commandName)
}

/** Interactive/long-running commands that inherit the terminal. */
const INTERACTIVE_COMMANDS = new Set(['exec', 'en', 'watch', 'mcp'])

export function isInteractive(commandName) {
  return INTERACTIVE_COMMANDS.has(commandName)
}