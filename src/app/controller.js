import { spawnSync } from 'node:child_process'
import { lstatSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { t } from '../config/i18n.js'
import { loadSettings, saveSettings } from '../config/settings.js'
import { DEFAULT_THEME } from '../config/themes.js'
import {
  commandBelongsToPage,
  commandCatalog,
  commandHelp,
  DASHBOARD_COMMANDS,
  defaultConfigTarget,
  execute,
  isInteractive,
  loadSnapshot,
  needsConfirmation,
  registry,
  remoteVersions,
  validateConfigTarget,
} from '../mise.js'
import {
  containsCaseInsensitive,
  deleteLastGrapheme,
  filterCommands,
  filterRegistryTools,
  FOCUS,
  focusSeq,
  moveIndex,
  PAGE,
  PAGE_ORDER,
  preferenceItems,
  supportsConfigTarget,
  VERSION_INTENT,
} from './state.js'

export class Application {
  #render
  #exit
  #dying = false
  #projectConfigMissing = false
  #detailMaxScroll = 0

  constructor(render, exit) {
    this.#render = render
    this.#exit = exit
    this.state = {
      page: PAGE.Dashboard,
      focus: FOCUS.Navigation,
      configTarget: null,
      language: 'en',
      theme: DEFAULT_THEME,
      snapshot: { mise_version: '—', tools: [], updates: [], tasks: [], configs: [] },
      selected: 0,
      detailScroll: 0,
      selectedUpdates: new Set(),
      search: '',
      status: '',
      overlay: null,
      logs: [],
      commands: [],
      loading: true,
      width: 100,
      height: 24,
      consoleTasks: [],
    }
  }

  update() {
    const viewport = this.#render(this.state, this)
    if (viewport) {
      this.state.width = viewport.width
      this.state.height = viewport.height
      this.#detailMaxScroll = viewport.detailMaxScroll
      this.state.detailScroll = Math.min(this.state.detailScroll, this.#detailMaxScroll)
      if (this.state.overlay && viewport.overlayMaxScroll != null)
        this.state.overlay.scroll = Math.min(this.state.overlay.scroll || 0, viewport.overlayMaxScroll)
    }
  }

  async start() {
    const settings = loadSettings()
    this.state.language = settings.language
    this.state.theme = settings.theme
    this.update()
    const refreshed = await this.refresh()
    if (refreshed && !this.state.configTarget && !this.state.overlay) {
      try {
        this.state.configTarget = defaultConfigTarget(this.state.snapshot.configs)
        this.update()
      }
      catch (error) {
        this.state.status = t(this.state.language, 'config_target_invalid', { error: error.message || String(error) })
      }
    }
    try {
      this.state.commands = await commandCatalog()
    }
    catch (error) {
      this.state.status = t(this.state.language, 'command_failed', { error: error.message || String(error) })
    }
    this.state.loading = false
    this.clampSelection()
    this.update()
  }

  async refresh() {
    try {
      const snapshot = await loadSnapshot()
      const selection = this.#captureSelection()
      this.state.snapshot = snapshot
      const names = new Set(snapshot.updates.map(item => item.name))
      for (const name of this.state.selectedUpdates) {
        if (!names.has(name))
          this.state.selectedUpdates.delete(name)
      }
      this.#restoreSelection(selection)
      this.state.status = ''
      this.update()
      return true
    }
    catch (error) {
      this.state.status = t(this.state.language, 'snapshot_load_failed', { error: error.message || String(error) })
      this.update()
      return false
    }
  }

  handleKey(key) {
    if (this.#dying)
      return
    if (this.state.overlay) {
      this.handleOverlayKey(key)
      return
    }
    const { name, ctrl, meta, shift } = key
    if (ctrl) {
      if (name === 'c')
        this.#quit()
      else if (name === 'd')
        this.moveVertical(5)
      else if (name === 'u')
        this.moveVertical(-5)
      return
    }
    if (meta)
      return
    switch (name) {
      case 'q': this.#quit(); return
      case '?': this.showHelp(); return
      case '/': this.toggleSearch(); return
      case 'r': void this.refresh(); return
      case 'f2': this.openConfigTarget(); return
      case 'a': void this.openRegistry(); return
      case 'A': this.openCustomTool(); return
      case ':': this.openCommandPalette(); return
      case 'm': this.openContextCommands(); return
      case '1': this.jumpToPage(PAGE.Dashboard); return
      case '2': this.jumpToPage(PAGE.Tools); return
      case '3': this.jumpToPage(PAGE.Updates); return
      case '4': this.jumpToPage(PAGE.Tasks); return
      case '5': this.jumpToPage(PAGE.Environment); return
      case '6': this.jumpToPage(PAGE.Config); return
      case '7': this.jumpToPage(PAGE.System); return
      case '8': this.jumpToPage(PAGE.Preferences); return
      case '9': this.jumpToPage(PAGE.Console); return
      case '0': this.jumpToPage(PAGE.Logs); return
      case '[': this.changePage(-1); return
      case ']': this.changePage(1); return
      case 'h':
      case 'left': this.moveFocus(-1); return
      case 'l':
      case 'right': this.moveFocus(1); return
      case 'j':
      case 'down': this.moveVertical(1); return
      case 'k':
      case 'up': this.moveVertical(-1); return
      case 'tab': this.cycleFocus(shift ? -1 : 1); return
      case 'home': this.#goTop(); return
      case 'end': this.#goBottom(); return
      case 'escape':
        if (this.state.focus === FOCUS.Details)
          this.state.focus = FOCUS.List
        else if (this.state.focus === FOCUS.List)
          this.state.focus = FOCUS.Navigation
        this.update()
        return
    }
    if (name === 'enter' && this.state.focus === FOCUS.Navigation) {
      this.state.focus = FOCUS.List
      this.update()
      return
    }
    if (this.state.focus === FOCUS.List)
      this.#handlePageKey(name)
  }

  #handlePageKey(name) {
    switch (this.state.page) {
      case PAGE.Tools:
        if (name === 'enter' || name === 'v')
          void this.useSelectedVersion()
        else if (name === 'i')
          void this.installSelectedVersion()
        else if (name === 'd')
          void this.deleteSelectedTool()
        break
      case PAGE.Updates:
        if (name === 'space')
          this.toggleSelectedUpdate()
        else if (name === 'enter' || name === 'u')
          void this.upgradeSelected()
        else if (name === 'U')
          void this.upgradeSelected(true)
        break
      case PAGE.Tasks:
        if (name === 'enter')
          void this.runSelectedTask()
        break
      case PAGE.Environment:
      case PAGE.System:
        if (name === 'enter')
          void this.runPageCommand()
        break
      case PAGE.Config:
        if (name === 'enter')
          this.selectConfigTarget()
        else if (name === 'e')
          void this.openConfig()
        else if (name === 'y')
          this.#copySelectedConfig()
        break
      case PAGE.Preferences:
        if (name === 'enter')
          this.applySelectedPreference()
        break
      case PAGE.Console:
        if (name === 'd') {
          this.#dismissConsoleTasks()
        }
        else if (name === 'enter' && this.visibleItems().length) {
          this.state.focus = FOCUS.Details
          this.update()
        }
        break
      case PAGE.Logs:
        if (name === 'enter' && this.selectedLog()) {
          this.state.focus = FOCUS.Details
          this.update()
        }
        break
      case PAGE.Dashboard: break
    }
  }

  #quit() {
    this.#dying = true
    this.#exit(0)
  }

  handleOverlayKey(key) {
    const ov = this.state.overlay
    if (!ov)
      return
    if (key.ctrl && key.name === 'c') {
      this.#cancelOverlayFlow()
      return
    }
    if (!key.ctrl && !key.meta && (key.name === 'pageup' || key.name === 'pagedown')
      && ['ConfigTarget', 'CustomTool', 'Picker'].includes(ov.type)) {
      this.#scrollOverlay(ov, key.name)
      return
    }
    if (!key.ctrl && !key.meta && key.name === 'f2'
      && (ov.type === 'CustomTool' || (ov.type === 'Picker' && ov.intent !== VERSION_INTENT.Install))) {
      if (ov.loading) {
        ov.error = t(this.state.language, 'config_target_wait')
        ov.scroll = 0
        this.update()
      }
      else {
        this.openConfigTarget(ov)
      }
      return
    }
    switch (ov.type) {
      case 'Search': this.handleSearchKey(key); break
      case 'Help': this.#handleHelpKey(key); break
      case 'ConfigTarget': this.handleConfigTargetKey(key); break
      case 'Picker': this.handlePickerKey(key); break
      case 'CommandPalette': this.handleCommandPaletteKey(key); break
      case 'CommandBuilder': this.handleCommandBuilderKey(key); break
      case 'CustomTool': this.handleCustomToolKey(key); break
      case 'ConfirmDelete':
      case 'ConfirmCommand': this.handleConfirmKey(key); break
    }
  }

  toggleSearch() {
    this.state.overlay = {
      type: 'Search',
      parent: null,
      previousSearch: this.state.search,
      previousSelected: this.state.selected,
    }
    this.update()
  }

  handleSearchKey(key) {
    const ov = this.state.overlay
    const { name, ctrl, meta, text } = key
    if (ctrl || meta) {
      if (ctrl && !meta && name === 'u')
        this.state.search = ''
      else return
    }
    else if (name === 'enter') {
      this.#closeOverlay()
      return
    }
    else if (name === 'escape') {
      this.state.search = ov.previousSearch
      this.state.selected = ov.previousSelected
      this.state.detailScroll = 0
      this.clampSelection()
      this.#closeOverlay()
      return
    }
    else if (name === 'backspace') {
      this.state.search = deleteLastGrapheme(this.state.search)
    }
    else if (text) {
      this.state.search += text
    }
    else {
      return
    }
    this.state.selected = 0
    this.state.detailScroll = 0
    this.clampSelection()
    this.update()
  }

  #beginSearch(ov) {
    ov.previousSearch = { search: ov.search, selected: ov.selected }
    ov.searching = true
    this.update()
  }

  #editSearch(ov, key, items) {
    const { name, ctrl, meta, text } = key
    if (ctrl || meta) {
      if (ctrl && !meta && name === 'u')
        ov.search = ''
      else return
    }
    else if (name === 'enter') {
      ov.searching = false
      this.update()
      return
    }
    else if (name === 'escape') {
      Object.assign(ov, ov.previousSearch)
      ov.searching = false
      this.update()
      return
    }
    else if (name === 'backspace') {
      ov.search = deleteLastGrapheme(ov.search)
    }
    else if (text) {
      ov.search += text
    }
    else {
      return
    }
    ov.selected = 0
    ov.selected = Math.max(0, Math.min(ov.selected, items().length - 1))
    this.update()
  }

  #handleHelpKey(key) {
    if (key.ctrl || key.meta)
      return
    if (key.name === 'escape' || key.name === 'q')
      this.#closeOverlay()
    else this.#scrollOverlay(this.state.overlay, key.name)
  }

  #scrollOverlay(ov, name) {
    switch (name) {
      case 'j':
      case 'down': ov.scroll = Math.min(Number.MAX_SAFE_INTEGER, (ov.scroll || 0) + 1); break
      case 'k':
      case 'up': ov.scroll = Math.max(0, (ov.scroll || 0) - 1); break
      case 'pageup': ov.scroll = Math.max(0, (ov.scroll || 0) - 10); break
      case 'pagedown': ov.scroll = Math.min(Number.MAX_SAFE_INTEGER, (ov.scroll || 0) + 10); break
      case 'home': ov.scroll = 0; break
      case 'end': ov.scroll = Number.MAX_SAFE_INTEGER; break
      default: return
    }
    this.update()
  }

  // Configuration discovery is read at action boundaries, never during rendering.
  #checkProjectCandidate() {
    this.#projectConfigMissing = false
    try {
      lstatSync(resolve('mise.toml'))
    }
    catch (error) {
      this.#projectConfigMissing = error.code === 'ENOENT'
    }
  }

  configTargetItems(ov = this.state.overlay) {
    const seen = new Set()
    const items = []
    for (const config of this.state.snapshot.configs) {
      const path = resolve(config.path)
      if (seen.has(path))
        continue
      seen.add(path)
      if (containsCaseInsensitive(path, ov?.search || ''))
        items.push({ kind: 'file', path, supported: supportsConfigTarget(path) })
    }
    if (this.#projectConfigMissing)
      items.push({ kind: 'project', path: resolve('mise.toml'), supported: true })
    items.push({ kind: 'path' })
    return items
  }

  openConfigTarget(parent = null, resume = null) {
    this.#checkProjectCandidate()
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
    const current = this.state.configTarget
      ? this.configTargetItems(ov).findIndex(item => item.path === this.state.configTarget.path)
      : -1
    ov.selected = Math.max(0, current)
    this.state.overlay = ov
    this.update()
  }

  selectConfigTarget(path = this.selectedConfig()?.path) {
    if (!path)
      return false
    try {
      this.state.configTarget = validateConfigTarget(path)
      this.state.status = t(this.state.language, 'config_target_selected', { path: this.state.configTarget.path })
      this.update()
      return true
    }
    catch (error) {
      this.state.status = t(this.state.language, 'config_target_invalid', { error: error.message || String(error) })
      this.update()
      return false
    }
  }

  #acceptConfigTarget(ov, target) {
    this.state.configTarget = target
    this.state.status = t(this.state.language, 'config_target_selected', { path: target.path })
    this.state.overlay = ov.parent
    if (ov.parent && !ov.parent.loadError)
      ov.parent.error = ''
    const resume = ov.resume
    if (resume?.kind === 'add')
      void this.openRegistry()
    else if (resume?.kind === 'custom')
      this.openCustomTool()
    else if (resume?.kind === 'use')
      void this.openVersionsForAction(VERSION_INTENT.Use, resume.tool)
    else this.update()
  }

  #chooseConfigTarget(ov, path, allowCreate) {
    try {
      const target = validateConfigTarget(path, allowCreate)
      if (!target.create) {
        this.#acceptConfigTarget(ov, target)
        return
      }
      this.state.overlay = {
        type: 'ConfirmCommand',
        parent: ov,
        scroll: 0,
        message: t(this.state.language, 'config_target_create', { path: target.path }),
        onConfirm: () => {
          try {
            this.#acceptConfigTarget(ov, validateConfigTarget(target.path, true))
          }
          catch (error) {
            this.state.overlay = ov
            ov.error = t(this.state.language, 'config_target_invalid', { error: error.message || String(error) })
            ov.scroll = 0
            this.update()
          }
        },
      }
      this.update()
    }
    catch (error) {
      ov.error = t(this.state.language, 'config_target_invalid', { error: error.message || String(error) })
      ov.scroll = 0
      this.update()
    }
  }

  handleConfigTargetKey(key) {
    const ov = this.state.overlay
    const { name, ctrl, meta, text } = key
    if (ov.mode === 'path') {
      if (ctrl || meta) {
        if (ctrl && !meta && name === 'u')
          ov.input = ''
        else return
      }
      else if (name === 'escape') {
        ov.mode = 'list'
        ov.error = ''
      }
      else if (name === 'enter') {
        if (!ov.input.trim())
          return
        const input = ov.input.trim()
        const path = input.startsWith('~/') ? resolve(homedir(), input.slice(2)) : resolve(input)
        this.#chooseConfigTarget(ov, path, true)
        return
      }
      else if (name === 'backspace') {
        ov.input = deleteLastGrapheme(ov.input)
      }
      else if (text) {
        ov.input += text
      }
      else {
        return
      }
      this.update()
      return
    }
    if (ov.searching) {
      this.#editSearch(ov, key, () => this.configTargetItems(ov))
      return
    }
    if (ctrl || meta)
      return
    if (name === 'escape' || name === 'q') { this.#closeOverlay(); return }
    if (name === '/') { this.#beginSearch(ov); return }
    if (name === 'r') {
      void (async () => {
        const success = await this.refresh()
        if (this.state.overlay !== ov)
          return
        this.#checkProjectCandidate()
        ov.error = success ? '' : this.state.status
        ov.scroll = 0
        ov.selected = Math.max(0, Math.min(ov.selected, this.configTargetItems(ov).length - 1))
        this.update()
      })()
      return
    }
    const items = this.configTargetItems(ov)
    if (name === 'enter') {
      const item = items[ov.selected]
      if (!item)
        return
      ov.error = ''
      if (item.kind === 'path') {
        ov.mode = 'path'
        this.update()
      }
      else {
        this.#chooseConfigTarget(ov, item.path, item.kind === 'project')
      }
      return
    }
    this.#moveOverlaySelection(ov, name, items.length)
  }

  async openRegistry() {
    if (!this.state.configTarget) {
      this.openConfigTarget(null, { kind: 'add' })
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
    this.state.overlay = ov
    await this.#loadPicker(ov)
  }

  async #loadPicker(ov) {
    ov.loading = true
    ov.error = ''
    ov.scroll = 0
    ov.loadError = false
    this.update()
    try {
      const result = ov.level === 'registry' ? await registry() : await remoteVersions(ov.toolSpecName)
      if (this.state.overlay !== ov)
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
      if (this.state.overlay !== ov)
        return
      ov.loading = false
      ov.loadError = true
      ov.error = error.message || String(error)
    }
    this.update()
  }

  async #openBackends(tool, parent) {
    if (!tool.backends?.length) {
      await this.#openVersions(tool.name, parent)
    }
    else if (tool.backends.length === 1) {
      await this.#openVersions(`${tool.backends[0]}:${tool.name}`, parent)
    }
    else {
      this.state.overlay = {
        type: 'Picker',
        parent,
        level: 'backends',
        tool,
        backendList: tool.backends,
        selected: 0,
        intent: VERSION_INTENT.Use,
        error: '',
      }
      this.update()
    }
  }

  async #openVersions(toolSpecName, parent, intent = VERSION_INTENT.Use) {
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
    this.state.overlay = ov
    await this.#loadPicker(ov)
  }

  handlePickerKey(key) {
    const ov = this.state.overlay
    const { name, ctrl, meta, shift } = key
    if (ov.level === 'registry' && ov.searching) {
      this.#editSearch(ov, key, () => filterRegistryTools(ov))
      return
    }
    if (ctrl || meta)
      return
    if (name === 'escape' || name === 'q') { this.#closeOverlay(); return }
    if (ov.loading)
      return
    if (name === 'r' && ov.level !== 'backends') { void this.#loadPicker(ov); return }
    if (ov.level === 'registry') {
      if (name === '/') { this.#beginSearch(ov); return }
      if (name === 'tab') {
        ov.filterIdx = moveIndex(ov.filterIdx, shift ? -1 : 1, ov.backends.length)
        ov.selected = 0
        this.update()
        return
      }
      const items = filterRegistryTools(ov)
      if (name === 'enter') {
        if (!ov.loadError && items[ov.selected])
          void this.#openBackends(items[ov.selected], ov)
      }
      else {
        this.#moveOverlaySelection(ov, name, items.length)
      }
    }
    else if (ov.level === 'backends') {
      if (name === 'enter') {
        const backend = ov.backendList[ov.selected]
        if (backend)
          void this.#openVersions(`${backend}:${ov.tool.name}`, ov)
      }
      else {
        this.#moveOverlaySelection(ov, name, ov.backendList.length)
      }
    }
    else if (ov.level === 'versions') {
      if (name === 'enter') {
        const version = ov.versions[ov.selected]
        if (!version || ov.loadError)
          return
        const spec = `${ov.toolSpecName}@${version.version}`
        if (ov.intent === VERSION_INTENT.Install) {
          this.#cancelOverlayFlow()
          this.executeBackground(['install', '--yes', spec], `install ${spec}`)
        }
        else if (this.useTool(spec)) {
          this.#cancelOverlayFlow()
        }
      }
      else {
        this.#moveOverlaySelection(ov, name, ov.versions.length)
      }
    }
  }

  #moveOverlaySelection(ov, name, length) {
    switch (name) {
      case 'j':
      case 'down': ov.selected = moveIndex(ov.selected, 1, length); break
      case 'k':
      case 'up': ov.selected = moveIndex(ov.selected, -1, length); break
      case 'home': ov.selected = 0; break
      case 'end': ov.selected = Math.max(0, length - 1); break
      default: return
    }
    if (ov.type === 'ConfigTarget')
      ov.scroll = 0
    this.update()
  }

  openCommandPalette() {
    this.state.overlay = {
      type: 'CommandPalette',
      parent: null,
      commands: this.state.commands,
      selected: 0,
      search: '',
      searching: false,
      context: false,
    }
    this.update()
  }

  openContextCommands() {
    const { page, commands } = this.state
    this.state.overlay = {
      type: 'CommandPalette',
      parent: null,
      commands: commands.filter(command => page === PAGE.Dashboard
        ? DASHBOARD_COMMANDS.includes(command.name)
        : commandBelongsToPage(page, command.name)),
      selected: 0,
      search: '',
      searching: false,
      context: true,
    }
    this.update()
  }

  handleCommandPaletteKey(key) {
    const ov = this.state.overlay
    if (ov.searching) {
      this.#editSearch(ov, key, () => filterCommands(ov.commands, ov.search))
      return
    }
    if (key.ctrl || key.meta)
      return
    const { name } = key
    if (name === 'escape' || name === 'q') { this.#closeOverlay(); return }
    if (name === '/') { this.#beginSearch(ov); return }
    const items = filterCommands(ov.commands, ov.search)
    if (name === 'enter') {
      if (items[ov.selected])
        void this.#openCommandBuilder(items[ov.selected], ov)
    }
    else {
      this.#moveOverlaySelection(ov, name, items.length)
    }
  }

  async #openCommandBuilder(command, parent = null) {
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
    this.state.overlay = ov
    await this.#loadCommandHelp(ov)
  }

  async #loadCommandHelp(ov) {
    ov.loading = true
    ov.error = ''
    ov.scroll = 0
    this.update()
    try {
      const help = await commandHelp(ov.command.name)
      if (this.state.overlay !== ov)
        return
      ov.help = help
      ov.loading = false
    }
    catch (error) {
      if (this.state.overlay !== ov)
        return
      ov.error = error.message || String(error)
      ov.loading = false
    }
    this.update()
  }

  handleCommandBuilderKey(key) {
    const ov = this.state.overlay
    const { name, ctrl, meta, text } = key
    if (ctrl || meta) {
      if (ctrl && !meta && name === 'u' && ov.mode === 'input') {
        ov.args = ''
        this.update()
      }
      return
    }
    if (ov.mode === 'help') {
      if (name === 'escape' || name === 'q' || name === 'tab' || name === 'enter') {
        ov.mode = 'input'
        this.update()
      }
      else if (name === 'r' && !ov.loading) {
        void this.#loadCommandHelp(ov)
      }
      else {
        this.#scrollOverlay(ov, name)
      }
      return
    }
    if (name === 'escape') { this.#closeOverlay(); return }
    if (name === 'tab') {
      ov.mode = 'help'
      this.update()
      return
    }
    if (name === 'enter') {
      if (ov.loading || ov.error)
        return
      const args = ov.args.trim() ? ov.args.trim().split(/\s+/) : []
      if (needsConfirmation(ov.command.name)) {
        this.#confirmCommand(ov.command.name, args, ov)
      }
      else {
        this.#cancelOverlayFlow()
        void this.executeCommand([ov.command.name, ...args], false)
      }
      return
    }
    if (name === 'backspace')
      ov.args = deleteLastGrapheme(ov.args)
    else if (text)
      ov.args += text
    else return
    this.update()
  }

  openCustomTool() {
    if (!this.state.configTarget) {
      this.openConfigTarget(null, { kind: 'custom' })
      return
    }
    this.state.overlay = { type: 'CustomTool', parent: null, input: '', error: '' }
    this.update()
  }

  handleCustomToolKey(key) {
    const ov = this.state.overlay
    const { name, ctrl, meta, text } = key
    if (ctrl || meta) {
      if (ctrl && !meta && name === 'u')
        ov.input = ''
      else return
    }
    else if (name === 'escape') { this.#closeOverlay(); return }
    else if (name === 'enter') {
      const spec = ov.input.trim()
      if (spec && this.useTool(spec))
        this.#cancelOverlayFlow()
      return
    }
    else if (name === 'backspace') {
      ov.input = deleteLastGrapheme(ov.input)
    }
    else if (text) {
      ov.input += text
    }
    else {
      return
    }
    this.update()
  }

  useTool(spec) {
    let target
    try {
      if (!this.state.configTarget)
        throw new Error(t(this.state.language, 'config_target_none'))
      target = validateConfigTarget(this.state.configTarget.path, this.state.configTarget.create)
      this.state.configTarget = target
    }
    catch (error) {
      const message = t(this.state.language, 'config_target_invalid', { error: error.message || String(error) })
      if (this.state.overlay) {
        this.state.overlay.error = message
        this.state.overlay.scroll = 0
      }
      this.state.status = message
      this.update()
      return false
    }
    this.executeBackground(['use', '--yes', '--path', target.path, spec], `use ${spec} → ${target.path}`, (task) => {
      if (this.state.configTarget?.path !== target.path)
        return
      let created = task.status === 'done'
      if (!created) {
        try { created = statSync(target.path).isFile() }
        catch (error) {
          if (error.code !== 'ENOENT')
            throw error
        }
      }
      if (created)
        this.state.configTarget = { path: target.path, create: false }
    })
    return true
  }

  #confirmCommand(command, args, parent) {
    this.state.overlay = {
      type: 'ConfirmCommand',
      parent,
      command,
      args,
      scroll: 0,
      message: t(this.state.language, 'confirm_command', { command: ['mise', command, ...args].join(' ') }),
    }
    this.update()
  }

  #confirmDelete(name, onConfirm) {
    this.state.overlay = {
      type: 'ConfirmDelete',
      parent: null,
      name,
      scroll: 0,
      onConfirm,
      message: t(this.state.language, 'confirm_delete', { name }),
    }
    this.update()
  }

  handleConfirmKey(key) {
    if (key.ctrl || key.meta)
      return
    const ov = this.state.overlay
    const { name } = key
    if (name === 'enter' || name === 'y') {
      this.#cancelOverlayFlow()
      if (ov.onConfirm)
        ov.onConfirm()
      else if (ov.command)
        void this.executeCommand([ov.command, ...(ov.args || [])], false)
    }
    else if (name === 'escape' || name === 'n' || name === 'q') {
      this.#closeOverlay()
    }
    else {
      this.#scrollOverlay(ov, name)
    }
  }

  async executeCommand(args, passthrough) {
    const cmdStr = args.join(' ')
    if (!passthrough && ['use', 'install', 'uninstall', 'upgrade'].includes(args[0])) {
      this.executeBackground(args, cmdStr)
      return
    }
    this.state.status = t(this.state.language, 'executing', { command: cmdStr })
    this.update()
    try {
      if (passthrough || isInteractive(args[0])) {
        const proc = Bun.spawn(['mise', ...args], { stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' })
        const exitCode = await proc.exited
        this.finishCommand({ command: `mise ${cmdStr}`, output: '', success: exitCode === 0 })
      }
      else {
        this.finishCommand(await execute(args))
      }
    }
    catch (error) {
      this.finishCommand({ command: `mise ${cmdStr}`, output: error.message || String(error), success: false })
    }
  }

  finishCommand(result) {
    const selection = this.#captureSelection()
    this.state.logs.unshift({ command: result.command || '', output: result.output || '', success: result.success !== false })
    this.state.logs.length = Math.min(this.state.logs.length, 100)
    this.#restoreSelection(selection)
    this.state.status = result.success
      ? t(this.state.language, 'command_success')
      : t(this.state.language, 'command_failed', { error: result.output || t(this.state.language, 'unknown_error') })
    this.update()
    if (result.success)
      void this.refresh()
  }

  executeBackground(args, label, onComplete = null) {
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
    const selection = this.#captureSelection()
    this.state.consoleTasks.unshift(task)
    this.state.consoleTasks.length = Math.min(this.state.consoleTasks.length, 100)
    this.#restoreSelection(selection)
    this.update()
    void (async () => {
      try {
        const proc = Bun.spawn(['mise', ...argv], { stdout: 'pipe', stderr: 'pipe' })
        task.status = 'running'
        this.update()
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
      this.finishCommand({ command: task.command, output: task.output, success: task.status === 'done' })
    })()
    return task
  }

  async useSelectedVersion() {
    await this.openVersionsForAction(VERSION_INTENT.Use)
  }

  async installSelectedVersion() {
    await this.openVersionsForAction(VERSION_INTENT.Install)
  }

  async openVersionsForAction(intent, tool = this.selectedTool()) {
    if (!tool)
      return
    if (intent !== VERSION_INTENT.Install && !this.state.configTarget) {
      this.openConfigTarget(null, { kind: 'use', tool: { ...tool } })
      return
    }
    await this.#openVersions(tool.name, null, intent)
  }

  async deleteSelectedTool() {
    const tool = this.selectedTool()
    if (!tool)
      return
    const spec = `${tool.name}@${tool.version}`
    this.#confirmDelete(spec, () => this.executeBackground(['uninstall', '--yes', spec], `uninstall ${spec}`))
  }

  toggleSelectedUpdate() {
    const update = this.selectedUpdate()
    if (!update)
      return
    if (this.state.selectedUpdates.has(update.name))
      this.state.selectedUpdates.delete(update.name)
    else this.state.selectedUpdates.add(update.name)
    this.update()
  }

  async upgradeSelected(allVisible = false) {
    const visible = this.visibleItems()
    if (this.state.page !== PAGE.Updates || !visible.length)
      return
    const marked = this.state.selectedUpdates.size > 0
    const updates = allVisible
      ? visible
      : marked
        ? this.state.snapshot.updates.filter(item => this.state.selectedUpdates.has(item.name))
        : [visible[this.state.selected]].filter(Boolean)
    const names = [...new Set(updates.map(item => item.name))]
    if (!names.length)
      return
    const range = t(this.state.language, allVisible ? 'upgrade_visible' : marked ? 'upgrade_marked' : 'upgrade_current')
    this.state.overlay = {
      type: 'ConfirmCommand',
      parent: null,
      command: 'upgrade',
      args: ['--yes', ...names],
      scroll: 0,
      message: `${t(this.state.language, 'confirm_upgrade', { count: names.length, range })}\n${names.join('\n')}\n\n${t(this.state.language, 'operation_not_target')}`,
      onConfirm: () => {
        for (const name of names) this.state.selectedUpdates.delete(name)
        this.executeBackground(['upgrade', '--yes', ...names], `upgrade ${names.join(' ')}`)
      },
    }
    this.update()
  }

  async runSelectedTask() {
    const task = this.selectedTask()
    if (task)
      await this.executeCommand(['run', task.name], true)
  }

  async openConfig() {
    const config = this.selectedConfig()
    if (config)
      await this.executeCommand(['edit', config.path], true)
  }

  async runPageCommand() {
    const command = this.selectedPageCommand()
    if (command)
      await this.#openCommandBuilder(command)
  }

  applySelectedPreference() {
    const candidate = this.visibleItems()[this.state.selected]
    if (!candidate || candidate.id === (candidate.kind === 'theme' ? this.state.theme : this.state.language))
      return
    const settings = candidate.kind === 'theme'
      ? { language: this.state.language, theme: candidate.id }
      : { language: candidate.id, theme: this.state.theme }
    try {
      saveSettings(settings)
      this.state.language = settings.language
      this.state.theme = settings.theme
      this.state.status = candidate.kind === 'theme'
        ? t(settings.language, 'current_theme', { theme: candidate.name })
        : t(settings.language, 'current_language', { lang: candidate.name })
    }
    catch (error) {
      this.state.status = t(this.state.language, 'preference_save_failed', { error: error.message || String(error) })
    }
    this.update()
  }

  showHelp() {
    this.state.overlay = { type: 'Help', parent: null, scroll: 0 }
    this.update()
  }

  jumpToPage(page, focus = FOCUS.List) {
    this.state.overlay = null
    this.state.focus = focus
    if (this.state.page !== page) {
      this.state.page = page
      this.state.selected = page === PAGE.Preferences
        ? Math.max(0, preferenceItems().findIndex(item => item.kind === 'language' && item.id === this.state.language))
        : 0
      this.state.detailScroll = 0
      this.state.search = ''
    }
    this.clampSelection()
    this.update()
  }

  changePage(delta, focus = FOCUS.List) {
    this.jumpToPage(PAGE_ORDER[moveIndex(PAGE_ORDER.indexOf(this.state.page), delta, PAGE_ORDER.length)], focus)
  }

  cycleFocus(delta) {
    const seq = focusSeq()
    this.state.focus = seq[moveIndex(seq.indexOf(this.state.focus), delta, seq.length)]
    this.update()
  }

  moveVertical(delta) {
    if (this.state.focus === FOCUS.Navigation) {
      this.changePage(delta, FOCUS.Navigation)
    }
    else if (this.state.focus === FOCUS.List) {
      this.state.selected = moveIndex(this.state.selected, delta, this.currentListLen())
      this.state.detailScroll = 0
      this.clampSelection()
      this.update()
    }
    else {
      this.state.detailScroll = Math.max(0, Math.min(this.#detailMaxScroll, this.state.detailScroll + delta))
      this.update()
    }
  }

  moveFocus(delta) {
    const seq = focusSeq()
    this.state.focus = seq[Math.max(0, Math.min(seq.length - 1, seq.indexOf(this.state.focus) + delta))]
    this.update()
  }

  #goTop() {
    if (this.state.focus === FOCUS.List)
      this.state.selected = 0
    this.state.detailScroll = 0
    this.update()
  }

  #goBottom() {
    if (this.state.focus === FOCUS.List) {
      this.state.selected = Math.max(0, this.currentListLen() - 1)
      this.state.detailScroll = 0
    }
    else if (this.state.focus === FOCUS.Details) {
      this.state.detailScroll = this.#detailMaxScroll
    }
    this.update()
  }

  #dismissConsoleTasks() {
    const selection = this.#captureSelection()
    this.state.consoleTasks = this.state.consoleTasks.filter(task => task.status === 'pending' || task.status === 'running')
    this.#restoreSelection(selection)
    this.update()
  }

  #copyToClipboard(text) {
    const cmd = process.platform === 'darwin' ? 'pbcopy' : process.platform === 'linux' ? 'wl-copy' : 'clip'
    const proc = spawnSync(cmd, [], { input: text, timeout: 3000 })
    if (proc.status !== 0)
      throw new Error(proc.error?.message || proc.stderr?.toString() || 'clipboard unavailable')
  }

  #copySelectedConfig() {
    const config = this.selectedConfig()
    if (!config) {
      this.state.status = t(this.state.language, 'no_config_selected')
      this.update()
      return
    }
    try {
      this.#copyToClipboard(readFileSync(config.path, 'utf8'))
      this.state.status = t(this.state.language, 'config_copied', { path: config.path })
    }
    catch (error) {
      this.state.status = t(this.state.language, 'config_copy_failed', { error: error.message || String(error) })
    }
    this.update()
  }

  visibleItems() {
    const { page, snapshot, search, commands } = this.state
    const matches = (...fields) => fields.some(field => containsCaseInsensitive(field || '', search))
    switch (page) {
      case PAGE.Dashboard: return []
      case PAGE.Tools: return search ? snapshot.tools.filter(item => matches(item.name, item.version)) : snapshot.tools
      case PAGE.Updates: return search ? snapshot.updates.filter(item => matches(item.name, item.current)) : snapshot.updates
      case PAGE.Tasks: return search ? snapshot.tasks.filter(item => matches(item.name, item.description)) : snapshot.tasks
      case PAGE.Config: return search ? snapshot.configs.filter(item => matches(item.path, item.tools.join(' '))) : snapshot.configs
      case PAGE.Console: return search ? this.state.consoleTasks.filter(item => matches(item.label, item.command, item.output)) : this.state.consoleTasks
      case PAGE.Logs: return search ? this.state.logs.filter(item => matches(item.command, item.output)) : this.state.logs
      case PAGE.Environment:
      case PAGE.System: return filterCommands(commands.filter(item => commandBelongsToPage(page, item.name)), search)
      case PAGE.Preferences: return preferenceItems()
      default: return []
    }
  }

  selectedTool() { return this.state.page === PAGE.Tools ? this.visibleItems()[this.state.selected] || null : null }
  selectedUpdate() { return this.state.page === PAGE.Updates ? this.visibleItems()[this.state.selected] || null : null }
  selectedTask() { return this.state.page === PAGE.Tasks ? this.visibleItems()[this.state.selected] || null : null }
  selectedConfig() { return this.state.page === PAGE.Config ? this.visibleItems()[this.state.selected] || null : null }
  selectedLog() { return this.state.page === PAGE.Logs ? this.visibleItems()[this.state.selected] || null : null }
  selectedPageCommand() {
    return [PAGE.Environment, PAGE.System].includes(this.state.page) ? this.visibleItems()[this.state.selected] || null : null
  }

  currentListLen() { return this.visibleItems().length }

  clampSelection() {
    const len = this.currentListLen()
    this.state.selected = Math.max(0, Math.min(this.state.selected, len - 1))
    if (!len)
      this.state.detailScroll = 0
  }

  #itemKey(item) {
    if (!item)
      return null
    switch (this.state.page) {
      case PAGE.Tools: return `${item.name}\0${item.version}`
      case PAGE.Config: return item.path
      case PAGE.Console: return item.id
      case PAGE.Logs: return item
      case PAGE.Preferences: return item.id
      default: return item.name
    }
  }

  #captureSelection() {
    return this.#itemKey(this.visibleItems()[this.state.selected])
  }

  #restoreSelection(key) {
    const index = key === null ? -1 : this.visibleItems().findIndex(item => this.#itemKey(item) === key)
    if (index >= 0)
      this.state.selected = index
    else this.state.detailScroll = 0
    this.clampSelection()
  }

  #closeOverlay() {
    this.state.overlay = this.state.overlay?.parent || null
    this.update()
  }

  #cancelOverlayFlow() {
    this.state.overlay = null
    this.update()
  }
}
