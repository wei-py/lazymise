import { lstatSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { applyTextKey } from '../../vendor/lazy-kit/keys.js'
import { THEMES } from '../../vendor/lazy-kit/themes.js'
import { LANGUAGES, t } from '../config/i18n.js'
import { saveSettings } from '../config/settings.js'
import {
  commandBelongsToPage,
  commandHelp,
  DASHBOARD_COMMANDS,
  needsConfirmation,
  registry,
  remoteVersions,
  validateConfigTarget,
} from '../mise.js'
import { executeBackground, executeCommand } from './execution.js'
import {
  containsCaseInsensitive,
  filterCommands,
  filterRegistryTools,
  moveIndex,
  PAGE,
  supportsConfigTarget,
  VERSION_INTENT,
} from './state.js'

export function handleOverlayKey(app, key) {
  const ov = app.state.overlay
  if (!ov)
    return
  if (key.ctrl && key.name === 'c') {
    cancelOverlayFlow(app)
    return
  }
  if (
    !key.ctrl
    && !key.meta
    && (key.name === 'pageup' || key.name === 'pagedown')
    && ['ConfigTarget', 'CustomTool', 'Picker'].includes(ov.type)
  ) {
    scrollOverlay(app, ov, key.name)
    return
  }
  if (
    !key.ctrl
    && !key.meta
    && key.name === 'f2'
    && (ov.type === 'CustomTool' || (ov.type === 'Picker' && ov.intent !== VERSION_INTENT.Install))
  ) {
    if (ov.loading) {
      ov.error = t(app.state.language, 'config_target_wait')
      ov.scroll = 0
      app.update()
    }
    else {
      openConfigTarget(app, ov)
    }
    return
  }
  switch (ov.type) {
    case 'Search':
      handleSearchKey(app, key)
      break
    case 'Help':
      handleHelpKey(app, key)
      break
    case 'ConfigTarget':
      handleConfigTargetKey(app, key)
      break
    case 'Picker':
      handlePickerKey(app, key)
      break
    case 'CommandPalette':
      handleCommandPaletteKey(app, key)
      break
    case 'CommandBuilder':
      handleCommandBuilderKey(app, key)
      break
    case 'CustomTool':
      handleCustomToolKey(app, key)
      break
    case 'Settings':
      handleSettingsKey(app, key)
      break
    case 'Quit':
    case 'ConfirmDelete':
    case 'ConfirmCommand':
      handleConfirmKey(app, key)
      break
  }
}

export function toggleSearch(app) {
  app.state.overlay = {
    type: 'Search',
    parent: null,
    range: 'local',
    previousSearch: app.state.search,
    previousSelected: app.state.selected,
  }
  app.update()
}

export function handleSearchKey(app, key) {
  const ov = app.state.overlay
  if (!key.ctrl && !key.meta && key.name === 'tab') {
    switchSearchRange(app, ov)
    return
  }
  const result = applyTextKey(key, app.state.search, app.state.search.length)
  if (result.submit) {
    if (ov.range === 'add') {
      const items = ov.loading || ov.loadError ? [] : filterRegistryTools(ov)
      const item = items[ov.selected]
      if (!item)
        return
      if (item.direct && item.pinned) {
        if (useTool(app, item.name))
          cancelOverlayFlow(app)
      }
      else {
        void openBackends(app, item, ov)
      }
      return
    }
    closeOverlay(app)
    return
  }
  if (result.cancel) {
    app.state.search = ov.previousSearch
    app.state.selected = ov.previousSelected
    app.state.detailScroll = 0
    app.clampSelection()
    closeOverlay(app)
    return
  }
  if (result.value !== app.state.search) {
    app.state.search = result.value
    app.state.selected = 0
    app.state.detailScroll = 0
    app.clampSelection()
  }
  if (ov.range === 'add')
    ov.search = app.state.search
  app.update()
}

function switchSearchRange(app, ov) {
  ov.range = ov.range === 'add' ? 'local' : 'add'
  if (ov.range === 'add' && !ov.registryLoaded) {
    Object.assign(ov, {
      level: 'registry',
      tools: [],
      backends: ['All'],
      filterIdx: 0,
      selected: 0,
      search: app.state.search,
      registryLoaded: true,
    })
    void loadPicker(app, ov)
  }
  app.update()
}

export function beginSearch(app, ov) {
  ov.previousSearch = { search: ov.search, selected: ov.selected }
  ov.searching = true
  app.update()
}

export function editSearch(app, ov, key) {
  const result = applyTextKey(key, ov.search, ov.search.length)
  if (result.submit) {
    ov.searching = false
    app.update()
    return
  }
  if (result.cancel) {
    Object.assign(ov, ov.previousSearch)
    ov.searching = false
    app.update()
    return
  }
  if (result.value !== ov.search) {
    ov.search = result.value
    ov.selected = 0
  }
  app.update()
}

export function handleHelpKey(app, key) {
  if (key.ctrl || key.meta)
    return
  if (key.name === 'escape' || key.name === 'q')
    closeOverlay(app)
  else scrollOverlay(app, app.state.overlay, key.name)
}

export function scrollOverlay(app, ov, name) {
  switch (name) {
    case 'j':
    case 'down':
      ov.scroll = Math.min(Number.MAX_SAFE_INTEGER, (ov.scroll || 0) + 1)
      break
    case 'k':
    case 'up':
      ov.scroll = Math.max(0, (ov.scroll || 0) - 1)
      break
    case 'pageup':
      ov.scroll = Math.max(0, (ov.scroll || 0) - 10)
      break
    case 'pagedown':
      ov.scroll = Math.min(Number.MAX_SAFE_INTEGER, (ov.scroll || 0) + 10)
      break
    case 'home':
      ov.scroll = 0
      break
    case 'end':
      ov.scroll = Number.MAX_SAFE_INTEGER
      break
    default:
      return
  }
  app.update()
}

// Configuration discovery is read at action boundaries, never during rendering.
export function checkProjectCandidate(app) {
  app.projectConfigMissing = false
  try {
    lstatSync(resolve('mise.toml'))
  }
  catch (error) {
    app.projectConfigMissing = error.code === 'ENOENT'
  }
}

export function configTargetItems(app, ov = app.state.overlay) {
  const seen = new Set()
  const items = []
  for (const config of app.state.snapshot.configs) {
    const path = resolve(config.path)
    if (seen.has(path))
      continue
    seen.add(path)
    if (containsCaseInsensitive(path, ov?.search || ''))
      items.push({ kind: 'file', path, supported: supportsConfigTarget(path) })
  }
  if (app.projectConfigMissing)
    items.push({ kind: 'project', path: resolve('mise.toml'), supported: true })
  items.push({ kind: 'path' })
  return items
}

export function openConfigTarget(app, parent = null, resume = null) {
  checkProjectCandidate(app)
  const ov = {
    type: 'ConfigTarget',
    parent,
    resume,
    mode: 'list',
    search: '',
    searching: false,
    selected: 0,
    input: '',
    error: '',
  }
  const current = app.state.configTarget
    ? configTargetItems(app, ov).findIndex(item => item.path === app.state.configTarget.path)
    : -1
  ov.selected = Math.max(0, current)
  app.state.overlay = ov
  app.update()
}

export function selectConfigTarget(app, path = app.selectedConfig()?.path) {
  if (!path)
    return false
  try {
    app.state.configTarget = validateConfigTarget(path)
    app.state.status = t(app.state.language, 'config_target_selected', {
      path: app.state.configTarget.path,
    })
    app.update()
    return true
  }
  catch (error) {
    app.state.status = t(app.state.language, 'config_target_invalid', {
      error: error.message || String(error),
    })
    app.update()
    return false
  }
}

export function acceptConfigTarget(app, ov, target) {
  app.state.configTarget = target
  app.state.status = t(app.state.language, 'config_target_selected', { path: target.path })
  app.state.overlay = ov.parent
  if (ov.parent && !ov.parent.loadError)
    ov.parent.error = ''
  const resume = ov.resume
  if (resume?.kind === 'add')
    void openRegistry(app)
  else if (resume?.kind === 'custom')
    openCustomTool(app)
  else if (resume?.kind === 'use')
    void openVersionsForAction(app, VERSION_INTENT.Use, resume.tool)
  else app.update()
}

export function chooseConfigTarget(app, ov, path, allowCreate) {
  try {
    const target = validateConfigTarget(path, allowCreate)
    if (!target.create) {
      acceptConfigTarget(app, ov, target)
      return
    }
    app.state.overlay = {
      type: 'ConfirmCommand',
      parent: ov,
      scroll: 0,
      message: t(app.state.language, 'config_target_create', { path: target.path }),
      onConfirm: () => {
        try {
          acceptConfigTarget(app, ov, validateConfigTarget(target.path, true))
        }
        catch (error) {
          app.state.overlay = ov
          ov.error = t(app.state.language, 'config_target_invalid', {
            error: error.message || String(error),
          })
          ov.scroll = 0
          app.update()
        }
      },
    }
    app.update()
  }
  catch (error) {
    ov.error = t(app.state.language, 'config_target_invalid', {
      error: error.message || String(error),
    })
    ov.scroll = 0
    app.update()
  }
}

export function handleConfigTargetKey(app, key) {
  const ov = app.state.overlay
  const { name, ctrl, meta } = key
  if (ov.mode === 'path') {
    const result = applyTextKey(key, ov.input, ov.input.length)
    if (result.cancel) {
      ov.mode = 'list'
      ov.error = ''
      app.update()
      return
    }
    if (result.submit) {
      if (!ov.input.trim())
        return
      const input = ov.input.trim()
      const path = input.startsWith('~/') ? resolve(homedir(), input.slice(2)) : resolve(input)
      chooseConfigTarget(app, ov, path, true)
      return
    }
    if (result.value !== ov.input)
      ov.input = result.value
    app.update()
    return
  }
  if (ov.searching) {
    editSearch(app, ov, key)
    return
  }
  if (ctrl || meta)
    return
  if (name === 'escape' || name === 'q') {
    closeOverlay(app)
    return
  }
  if (name === '/') {
    beginSearch(app, ov)
    return
  }
  if (name === 'r') {
    void (async () => {
      const success = await app.refresh()
      if (app.state.overlay !== ov)
        return
      checkProjectCandidate(app)
      ov.error = success ? '' : app.state.status
      ov.scroll = 0
      ov.selected = Math.max(0, Math.min(ov.selected, configTargetItems(app, ov).length - 1))
      app.update()
    })()
    return
  }
  const items = configTargetItems(app, ov)
  if (name === 'enter') {
    const item = items[ov.selected]
    if (!item)
      return
    ov.error = ''
    if (item.kind === 'path') {
      ov.mode = 'path'
      app.update()
    }
    else {
      chooseConfigTarget(app, ov, item.path, item.kind === 'project')
    }
    return
  }
  moveOverlaySelection(app, ov, name, items.length)
}

export async function openRegistry(app) {
  if (!app.state.configTarget) {
    openConfigTarget(app, null, { kind: 'add' })
    return
  }
  const ov = {
    type: 'Picker',
    parent: null,
    level: 'registry',
    tools: [],
    backends: ['All'],
    filterIdx: 0,
    selected: 0,
    search: '',
    searching: false,
    intent: VERSION_INTENT.Use,
    loading: true,
    error: '',
  }
  app.state.overlay = ov
  await loadPicker(app, ov)
}

export async function loadPicker(app, ov) {
  ov.loading = true
  ov.error = ''
  ov.scroll = 0
  ov.loadError = false
  app.update()
  try {
    const result
      = ov.level === 'registry' ? await registry() : await remoteVersions(ov.toolSpecName)
    if (app.state.overlay !== ov)
      return
    if (ov.level === 'registry') {
      ov.tools = result
      const backends = new Set()
      for (const tool of result) {
        for (const backend of tool.backends) backends.add(backend)
      }
      ov.backends = ['All', ...Array.from(backends).sort()]
      ov.filterIdx = Math.min(ov.filterIdx, ov.backends.length - 1)
      ov.selected = Math.max(0, Math.min(ov.selected, filterRegistryTools(ov).length - 1))
    }
    else {
      ov.versions = result
      ov.selected = Math.max(0, Math.min(ov.selected, result.length - 1))
    }
    ov.loading = false
    ov.error = ''
  }
  catch (error) {
    if (app.state.overlay !== ov)
      return
    ov.loading = false
    ov.loadError = true
    ov.error = error.message || String(error)
  }
  app.update()
}

export async function openBackends(app, tool, parent) {
  if (!tool.backends?.length) {
    await openVersions(app, tool.name, parent)
  }
  else if (tool.backends.length === 1) {
    await openVersions(app, `${tool.backends[0]}:${tool.name}`, parent)
  }
  else {
    app.state.overlay = {
      type: 'Picker',
      parent,
      level: 'backends',
      tool,
      backendList: tool.backends,
      selected: 0,
      intent: VERSION_INTENT.Use,
      error: '',
    }
    app.update()
  }
}

export async function openVersions(app, toolSpecName, parent, intent = VERSION_INTENT.Use) {
  const ov = {
    type: 'Picker',
    parent,
    level: 'versions',
    toolSpecName,
    versions: [],
    selected: 0,
    intent,
    loading: true,
    error: '',
  }
  app.state.overlay = ov
  await loadPicker(app, ov)
}

export function handlePickerKey(app, key) {
  const ov = app.state.overlay
  const { name, ctrl, meta, shift } = key
  if (ov.level === 'registry' && ov.searching) {
    editSearch(app, ov, key)
    return
  }
  if (ctrl || meta)
    return
  if (name === 'escape' || name === 'q') {
    closeOverlay(app)
    return
  }
  if (ov.loading)
    return
  if (name === 'r' && ov.level !== 'backends') {
    void loadPicker(app, ov)
    return
  }
  if (ov.level === 'registry') {
    if (name === '/') {
      beginSearch(app, ov)
      return
    }
    if (name === 'tab') {
      ov.filterIdx = moveIndex(ov.filterIdx, shift ? -1 : 1, ov.backends.length)
      ov.selected = 0
      app.update()
      return
    }
    const items = filterRegistryTools(ov)
    if (name === 'enter') {
      const item = items[ov.selected]
      if (!ov.loadError && item) {
        if (item.direct && item.pinned) {
          if (useTool(app, item.name))
            cancelOverlayFlow(app)
        }
        else {
          void openBackends(app, item, ov)
        }
      }
    }
    else {
      moveOverlaySelection(app, ov, name, items.length)
    }
  }
  else if (ov.level === 'backends') {
    if (name === 'enter') {
      const backend = ov.backendList[ov.selected]
      if (backend)
        void openVersions(app, `${backend}:${ov.tool.name}`, ov)
    }
    else {
      moveOverlaySelection(app, ov, name, ov.backendList.length)
    }
  }
  else if (ov.level === 'versions') {
    if (name === 'enter') {
      const version = ov.versions[ov.selected]
      if (!version || ov.loadError)
        return
      const spec = `${ov.toolSpecName}@${version.version}`
      if (ov.intent === VERSION_INTENT.Install) {
        cancelOverlayFlow(app)
        executeBackground(app, ['install', '--yes', spec], `install ${spec}`)
      }
      else if (useTool(app, spec)) {
        cancelOverlayFlow(app)
      }
    }
    else {
      moveOverlaySelection(app, ov, name, ov.versions.length)
    }
  }
}

export function moveOverlaySelection(app, ov, name, length) {
  switch (name) {
    case 'j':
    case 'down':
      ov.selected = moveIndex(ov.selected, 1, length)
      break
    case 'k':
    case 'up':
      ov.selected = moveIndex(ov.selected, -1, length)
      break
    case 'home':
      ov.selected = 0
      break
    case 'end':
      ov.selected = Math.max(0, length - 1)
      break
    default:
      return
  }
  if (ov.type === 'ConfigTarget')
    ov.scroll = 0
  app.update()
}

export function openSettings(app) {
  app.state.overlay = { type: 'Settings', parent: null, cursor: 0 }
  app.update()
}

export function handleSettingsKey(app, key) {
  const ov = app.state.overlay
  if (key.ctrl || key.meta)
    return
  const { name } = key
  if (name === 'escape') {
    closeOverlay(app)
    return
  }
  if (name === 'j' || name === 'down') {
    ov.cursor = 1
    app.update()
    return
  }
  if (name === 'k' || name === 'up') {
    ov.cursor = 0
    app.update()
    return
  }
  if (name === 'enter' || name === 'l' || name === 'right') {
    cycleSetting(app, 1)
    return
  }
  if (name === 'h' || name === 'left')
    cycleSetting(app, -1)
}

function cycleSetting(app, delta) {
  const cursor = app.state.overlay.cursor
  const { language, theme } = app.state
  if (cursor === 0) {
    const ids = LANGUAGES.map(item => item.id)
    const next = ids[(ids.indexOf(language) + delta + ids.length) % ids.length]
    if (next !== language && persistSettings(app, { language: next, theme }))
      app.state.language = next
  }
  else {
    const ids = THEMES.map(entry => entry.id)
    const next = ids[(ids.indexOf(theme) + delta + ids.length) % ids.length]
    if (next !== theme && persistSettings(app, { language, theme: next }))
      app.state.theme = next
  }
  app.update()
}

function persistSettings(app, settings) {
  try {
    saveSettings(settings)
    return true
  }
  catch (error) {
    app.state.status = t(app.state.language, 'settings_save_failed', {
      error: error.message || String(error),
    })
    return false
  }
}

export function openCommandPalette(app) {
  app.state.overlay = {
    type: 'CommandPalette',
    parent: null,
    commands: app.state.commands,
    selected: 0,
    search: '',
    searching: false,
    context: false,
  }
  app.update()
}

export function openContextCommands(app) {
  const { page, commands } = app.state
  app.state.overlay = {
    type: 'CommandPalette',
    parent: null,
    commands: commands.filter(command =>
      page === PAGE.Dashboard
        ? DASHBOARD_COMMANDS.includes(command.name)
        : commandBelongsToPage(page, command.name),
    ),
    selected: 0,
    search: '',
    searching: false,
    context: true,
  }
  app.update()
}

export function handleCommandPaletteKey(app, key) {
  const ov = app.state.overlay
  if (ov.searching) {
    editSearch(app, ov, key)
    return
  }
  if (key.ctrl || key.meta)
    return
  const { name } = key
  if (name === 'escape' || name === 'q') {
    closeOverlay(app)
    return
  }
  if (name === '/') {
    beginSearch(app, ov)
    return
  }
  const items = filterCommands(ov.commands, ov.search)
  if (name === 'enter') {
    if (items[ov.selected])
      void openCommandBuilder(app, items[ov.selected], ov)
  }
  else {
    moveOverlaySelection(app, ov, name, items.length)
  }
}

export async function openCommandBuilder(app, command, parent = null) {
  const ov = {
    type: 'CommandBuilder',
    parent,
    command,
    help: '',
    args: '',
    mode: 'input',
    scroll: 0,
    loading: true,
    error: '',
  }
  app.state.overlay = ov
  await loadCommandHelp(app, ov)
}

export async function loadCommandHelp(app, ov) {
  ov.loading = true
  ov.error = ''
  ov.scroll = 0
  app.update()
  try {
    const help = await commandHelp(ov.command.name)
    if (app.state.overlay !== ov)
      return
    ov.help = help
    ov.loading = false
  }
  catch (error) {
    if (app.state.overlay !== ov)
      return
    ov.error = error.message || String(error)
    ov.loading = false
  }
  app.update()
}

export function handleCommandBuilderKey(app, key) {
  const ov = app.state.overlay
  const { name } = key
  if (ov.mode === 'help') {
    if (name === 'escape' || name === 'q' || name === 'tab' || name === 'enter') {
      ov.mode = 'input'
      app.update()
    }
    else if (name === 'r' && !ov.loading) {
      void loadCommandHelp(app, ov)
    }
    else {
      scrollOverlay(app, ov, name)
    }
    return
  }
  if (name === 'tab' && !key.ctrl && !key.meta) {
    ov.mode = 'help'
    app.update()
    return
  }
  const result = applyTextKey(key, ov.args, ov.args.length)
  if (result.cancel) {
    closeOverlay(app)
    return
  }
  if (result.submit) {
    if (ov.loading || ov.error)
      return
    const args = ov.args.trim() ? ov.args.trim().split(/\s+/) : []
    if (needsConfirmation(ov.command.name)) {
      confirmCommand(app, ov.command.name, args, ov)
    }
    else {
      cancelOverlayFlow(app)
      void executeCommand(app, [ov.command.name, ...args], false)
    }
    return
  }
  if (result.value !== ov.args)
    ov.args = result.value
  app.update()
}

export function openCustomTool(app) {
  if (!app.state.configTarget) {
    openConfigTarget(app, null, { kind: 'custom' })
    return
  }
  app.state.overlay = { type: 'CustomTool', parent: null, input: '', error: '' }
  app.update()
}

export function handleCustomToolKey(app, key) {
  const ov = app.state.overlay
  const result = applyTextKey(key, ov.input, ov.input.length)
  if (result.cancel) {
    closeOverlay(app)
    return
  }
  if (result.submit) {
    const spec = ov.input.trim()
    if (spec && useTool(app, spec))
      cancelOverlayFlow(app)
    return
  }
  if (result.value !== ov.input)
    ov.input = result.value
  app.update()
}

export function useTool(app, spec) {
  let target
  try {
    if (!app.state.configTarget)
      throw new Error(t(app.state.language, 'config_target_none'))
    target = validateConfigTarget(app.state.configTarget.path, app.state.configTarget.create)
    app.state.configTarget = target
  }
  catch (error) {
    const message = t(app.state.language, 'config_target_invalid', {
      error: error.message || String(error),
    })
    if (app.state.overlay) {
      app.state.overlay.error = message
      app.state.overlay.scroll = 0
    }
    app.state.status = message
    app.update()
    return false
  }
  executeBackground(
    app,
    ['use', '--yes', '--path', target.path, spec],
    `use ${spec} → ${target.path}`,
    (job) => {
      if (app.state.configTarget?.path !== target.path)
        return
      let created = job.state === 'done'
      if (!created) {
        try {
          created = statSync(target.path).isFile()
        }
        catch (error) {
          if (error.code !== 'ENOENT')
            throw error
        }
      }
      if (created)
        app.state.configTarget = { path: target.path, create: false }
    },
  )
  return true
}

export function confirmCommand(app, command, args, parent) {
  app.state.overlay = {
    type: 'ConfirmCommand',
    parent,
    command,
    args,
    scroll: 0,
    message: t(app.state.language, 'confirm_command', {
      command: ['mise', command, ...args].join(' '),
    }),
  }
  app.update()
}

export function confirmDelete(app, name, onConfirm) {
  app.state.overlay = {
    type: 'ConfirmDelete',
    parent: null,
    name,
    scroll: 0,
    onConfirm,
    message: t(app.state.language, 'confirm_delete', { name }),
  }
  app.update()
}

export function handleConfirmKey(app, key) {
  if (key.ctrl || key.meta)
    return
  const ov = app.state.overlay
  const { name } = key
  if (name === 'enter' || name === 'y') {
    cancelOverlayFlow(app)
    if (ov.onConfirm)
      ov.onConfirm()
    else if (ov.command)
      void executeCommand(app, [ov.command, ...(ov.args || [])], false)
  }
  else if (name === 'escape' || name === 'n' || name === 'q') {
    closeOverlay(app)
  }
  else {
    scrollOverlay(app, ov, name)
  }
}

export async function useSelectedVersion(app) {
  await openVersionsForAction(app, VERSION_INTENT.Use)
}

export async function installSelectedVersion(app) {
  await openVersionsForAction(app, VERSION_INTENT.Install)
}

export async function openVersionsForAction(app, intent, tool = app.selectedTool()) {
  if (!tool)
    return
  if (intent !== VERSION_INTENT.Install && !app.state.configTarget) {
    openConfigTarget(app, null, { kind: 'use', tool: { ...tool } })
    return
  }
  await openVersions(app, tool.name, null, intent)
}

export async function runPageCommand(app) {
  const command = app.selectedPageCommand()
  if (command)
    await openCommandBuilder(app, command)
}

export function showHelp(app) {
  app.state.overlay = { type: 'Help', parent: null, scroll: 0 }
  app.update()
}

export function closeOverlay(app) {
  app.state.overlay = app.state.overlay?.parent || null
  app.update()
}

export function cancelOverlayFlow(app) {
  app.state.overlay = null
  app.update()
}
