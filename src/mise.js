import { lstatSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, resolve } from 'node:path'
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
    const entries = JSON.parse(await miseText(['ls', '--json']))
    const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    if (!isObject(entries))
      throw new Error('expected an object of tool version arrays')
    const tools = []
    for (const [name, versions] of Object.entries(entries)) {
      if (!Array.isArray(versions))
        throw new Error(`${name}: expected a version array`)
      for (const [index, record] of versions.entries()) {
        const fieldError = field => new Error(`${name}[${index}]: invalid ${field}`)
        if (!isObject(record))
          throw fieldError('version record')
        if (typeof record.version !== 'string')
          throw fieldError('version (expected string)')
        if ('requested_version' in record && typeof record.requested_version !== 'string')
          throw fieldError('requested_version (expected string)')
        for (const field of ['installed', 'active']) {
          if (field in record && typeof record[field] !== 'boolean')
            throw fieldError(`${field} (expected boolean)`)
        }
        if (record.source != null) {
          if (!isObject(record.source))
            throw fieldError('source (expected object or null)')
          if (record.source.path != null && typeof record.source.path !== 'string')
            throw fieldError('source.path (expected string or null)')
        }
        tools.push({
          name,
          version: record.version,
          requested: record.requested_version || record.version,
          source: record.source?.path ?? null,
          installed: record.installed ?? false,
          active: record.active ?? false,
        })
      }
    }
    return tools.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : Number(b.active) - Number(a.active))
  }
  catch (error) {
    const stderr = error.stderr?.toString().trim()
    throw new Error(`mise ls --json: ${error.message || String(error)}${stderr ? `: ${stderr}` : ''}`, { cause: error })
  }
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
    const entries = JSON.parse(await miseText(['config', 'ls', '--json']))
    if (!Array.isArray(entries))
      throw new Error('$: expected an array')
    return entries.map((entry, index) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
        throw new Error(`[${index}]: expected an object`)
      if (typeof entry.path !== 'string' || !entry.path.trim())
        throw new Error(`[${index}].path: expected a non-empty string`)
      if ('tools' in entry && (!Array.isArray(entry.tools) || entry.tools.some(tool => typeof tool !== 'string')))
        throw new Error(`[${index}].tools: expected a string array`)
      return { path: resolve(entry.path), tools: entry.tools ?? [] }
    })
  }
  catch (error) {
    const stderr = error.stderr?.toString().trim()
    throw new Error(`mise config ls --json: ${error.message || String(error)}${stderr ? `: ${stderr}` : ''}`, { cause: error })
  }
}

/** Validate an explicit write target without creating files or promising permissions. */
export function validateConfigTarget(path, allowCreate = false) {
  if (typeof path !== 'string' || !path.trim())
    throw new Error('Configuration path must be a non-empty string')
  const absolutePath = resolve(path)
  if (extname(absolutePath) !== '.toml' || basename(absolutePath) === 'rust-toolchain.toml')
    throw new Error(`Unsupported configuration format: ${absolutePath}`)
  let entry
  try {
    entry = lstatSync(absolutePath)
  }
  catch (error) {
    if (error.code !== 'ENOENT' || !allowCreate)
      throw error
    if (!statSync(dirname(absolutePath)).isDirectory())
      throw new Error(`Configuration parent is not a directory: ${dirname(absolutePath)}`)
    return { path: absolutePath, create: true }
  }
  // Follow a symlink only after lstat has proved the selected path exists.
  // A dangling link is never treated as authorization to create a new file.
  const target = entry.isSymbolicLink() ? statSync(absolutePath) : entry
  if (!target.isFile())
    throw new Error(`Configuration target is not a regular file: ${absolutePath}`)
  return { path: absolutePath, create: false }
}

/** Pick mise's global write file, never the first discovered project config. */
export function defaultConfigTarget(configs) {
  const configDir = process.env.MISE_CONFIG_DIR
    || resolve(process.env.XDG_CONFIG_HOME || resolve(homedir(), '.config'), 'mise')
  const path = resolve(process.env.MISE_GLOBAL_CONFIG_FILE || resolve(configDir, 'config.toml'))
  let target
  try {
    target = validateConfigTarget(path)
  }
  catch (error) {
    if (error.code === 'ENOENT')
      return null
    throw error
  }
  const canonicalPath = realpathSync(path)
  return configs.some(config => config.path === path || config.path === canonicalPath) ? target : null
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
  catch (error) {
    const stderr = error.stderr?.toString().trim()
    throw new Error(`mise registry --json: ${error.message || String(error)}${stderr ? `: ${stderr}` : ''}`, { cause: error })
  }
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
  catch (error) {
    const stderr = error.stderr?.toString().trim()
    throw new Error(`mise ls-remote ${tool} --json: ${error.message || String(error)}${stderr ? `: ${stderr}` : ''}`, { cause: error })
  }
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
    // eslint-disable-next-line regexp/no-misleading-capturing-group, regexp/no-super-linear-backtracking
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
  catch (error) {
    const stderr = error.stderr?.toString().trim()
    throw new Error(`mise ${command} -h: ${error.message || String(error)}${stderr ? `: ${stderr}` : ''}`, { cause: error })
  }
}

// Command groupings (ported from Rust lazymise)
export const TOOL_COMMANDS = [
  'backends',
  'install',
  'install-into',
  'latest',
  'link',
  'ls',
  'ls-remote',
  'plugins',
  'prune',
  'registry',
  'reshim',
  'search',
  'sync',
  'test-tool',
  'tool',
  'tool-alias',
  'tool-stub',
  'uninstall',
  'unuse',
  'use',
  'where',
]
export const UPDATE_COMMANDS = ['outdated', 'prune', 'upgrade']
export const TASK_COMMANDS = ['deps', 'run', 'tasks', 'watch']
export const ENVIRONMENT_COMMANDS = [
  'activate',
  'bin-paths',
  'deactivate',
  'en',
  'env',
  'exec',
  'shell',
  'shell-alias',
  'which',
]
export const CONFIG_COMMANDS = [
  'config',
  'edit',
  'fmt',
  'lock',
  'set',
  'settings',
  'trust',
  'unset',
  'untrust',
]
export const SYSTEM_COMMANDS = [
  'bootstrap',
  'cache',
  'completion',
  'doctor',
  'generate',
  'help',
  'implode',
  'mcp',
  'oci',
  'patrons',
  'self-update',
  'sponsors',
  'token',
  'version',
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
  'cache',
  'config',
  'implode',
  'prune',
  'self-update',
  'sync',
  'uninstall',
  'upgrade',
  'unset',
  'untrust',
  'unuse',
])

export function needsConfirmation(commandName) {
  return CONFIRM_COMMANDS.has(commandName)
}

/** Interactive/long-running commands that inherit the terminal. */
const INTERACTIVE_COMMANDS = new Set(['exec', 'en', 'watch', 'mcp'])

export function isInteractive(commandName) {
  return INTERACTIVE_COMMANDS.has(commandName)
}
