import { t } from '../config/i18n.js'
import { loadSettings, saveSettings } from '../config/settings.js'
import { DEFAULT_THEME } from '../config/themes.js'
import {
  commandBelongsToPage,
  commandCatalog,
  defaultConfigTarget,
  loadSnapshot,
} from '../mise.js'
import { copySelectedConfig, executeBackground, executeCommand } from './execution.js'
import {
  confirmDelete,
  handleOverlayKey,
  installSelectedVersion,
  openCommandPalette,
  openConfigTarget,
  openContextCommands,
  openCustomTool,
  openRegistry,
  runPageCommand,
  selectConfigTarget,
  showHelp,
  toggleSearch,
  useSelectedVersion,
} from './overlays.js'
import { captureSelection, restoreSelection } from './selection.js'
import {
  containsCaseInsensitive,
  filterCommands,
  FOCUS,
  focusSeq,
  moveIndex,
  PAGE,
  PAGE_ORDER,
  preferenceItems,
} from './state.js'

export class Application {
  #render
  #exit
  #dying = false
  #detailMaxScroll = 0
  projectConfigMissing = false

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
      if (this.state.overlay && viewport.overlayMaxScroll != null) {
        this.state.overlay.scroll = Math.min(
          this.state.overlay.scroll || 0,
          viewport.overlayMaxScroll,
        )
      }
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
        this.state.status = t(this.state.language, 'config_target_invalid', {
          error: error.message || String(error),
        })
      }
    }
    try {
      this.state.commands = await commandCatalog()
    }
    catch (error) {
      this.state.status = t(this.state.language, 'command_failed', {
        error: error.message || String(error),
      })
    }
    this.state.loading = false
    this.clampSelection()
    this.update()
  }

  async refresh() {
    try {
      const snapshot = await loadSnapshot()
      const selection = captureSelection(this)
      this.state.snapshot = snapshot
      const names = new Set(snapshot.updates.map(item => item.name))
      for (const name of this.state.selectedUpdates) {
        if (!names.has(name))
          this.state.selectedUpdates.delete(name)
      }
      restoreSelection(this, selection)
      this.state.status = ''
      this.update()
      return true
    }
    catch (error) {
      this.state.status = t(this.state.language, 'snapshot_load_failed', {
        error: error.message || String(error),
      })
      this.update()
      return false
    }
  }

  handleKey(key) {
    if (this.#dying)
      return
    if (this.state.overlay) {
      handleOverlayKey(this, key)
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
      case 'q':
        this.#quit()
        return
      case '?':
        showHelp(this)
        return
      case '/':
        toggleSearch(this)
        return
      case 'r':
        void this.refresh()
        return
      case 'f2':
        openConfigTarget(this)
        return
      case 'a':
        void openRegistry(this)
        return
      case 'A':
        openCustomTool(this)
        return
      case ':':
        openCommandPalette(this)
        return
      case 'm':
        openContextCommands(this)
        return
      case '1':
        this.jumpToPage(PAGE.Dashboard)
        return
      case '2':
        this.jumpToPage(PAGE.Tools)
        return
      case '3':
        this.jumpToPage(PAGE.Updates)
        return
      case '4':
        this.jumpToPage(PAGE.Tasks)
        return
      case '5':
        this.jumpToPage(PAGE.Environment)
        return
      case '6':
        this.jumpToPage(PAGE.Config)
        return
      case '7':
        this.jumpToPage(PAGE.System)
        return
      case '8':
        this.jumpToPage(PAGE.Preferences)
        return
      case '9':
        this.jumpToPage(PAGE.Console)
        return
      case '0':
        this.jumpToPage(PAGE.Logs)
        return
      case '[':
        this.changePage(-1)
        return
      case ']':
        this.changePage(1)
        return
      case 'h':
      case 'left':
        this.moveFocus(-1)
        return
      case 'l':
      case 'right':
        this.moveFocus(1)
        return
      case 'j':
      case 'down':
        this.moveVertical(1)
        return
      case 'k':
      case 'up':
        this.moveVertical(-1)
        return
      case 'tab':
        this.cycleFocus(shift ? -1 : 1)
        return
      case 'home':
        this.#goTop()
        return
      case 'end':
        this.#goBottom()
        return
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
          void useSelectedVersion(this)
        else if (name === 'i')
          void installSelectedVersion(this)
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
          void runPageCommand(this)
        break
      case PAGE.Config:
        if (name === 'enter')
          selectConfigTarget(this)
        else if (name === 'e')
          void this.openConfig()
        else if (name === 'y')
          copySelectedConfig(this)
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
      case PAGE.Dashboard:
        break
    }
  }

  #quit() {
    this.#dying = true
    this.#exit(0)
  }

  async deleteSelectedTool() {
    const tool = this.selectedTool()
    if (!tool)
      return
    const spec = `${tool.name}@${tool.version}`
    confirmDelete(this, spec, () =>
      executeBackground(this, ['uninstall', '--yes', spec], `uninstall ${spec}`))
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
    const range = t(
      this.state.language,
      allVisible ? 'upgrade_visible' : marked ? 'upgrade_marked' : 'upgrade_current',
    )
    this.state.overlay = {
      type: 'ConfirmCommand',
      parent: null,
      command: 'upgrade',
      args: ['--yes', ...names],
      scroll: 0,
      message: `${t(this.state.language, 'confirm_upgrade', { count: names.length, range })}\n${names.join('\n')}\n\n${t(this.state.language, 'operation_not_target')}`,
      onConfirm: () => {
        for (const name of names) this.state.selectedUpdates.delete(name)
        executeBackground(this, ['upgrade', '--yes', ...names], `upgrade ${names.join(' ')}`)
      },
    }
    this.update()
  }

  async runSelectedTask() {
    const task = this.selectedTask()
    if (task)
      await executeCommand(this, ['run', task.name], true)
  }

  async openConfig() {
    const config = this.selectedConfig()
    if (config)
      await executeCommand(this, ['edit', config.path], true)
  }

  applySelectedPreference() {
    const candidate = this.visibleItems()[this.state.selected]
    if (
      !candidate
      || candidate.id === (candidate.kind === 'theme' ? this.state.theme : this.state.language)
    ) {
      return
    }
    const settings
      = candidate.kind === 'theme'
        ? { language: this.state.language, theme: candidate.id }
        : { language: candidate.id, theme: this.state.theme }
    try {
      saveSettings(settings)
      this.state.language = settings.language
      this.state.theme = settings.theme
      this.state.status
        = candidate.kind === 'theme'
          ? t(settings.language, 'current_theme', { theme: candidate.name })
          : t(settings.language, 'current_language', { lang: candidate.name })
    }
    catch (error) {
      this.state.status = t(this.state.language, 'preference_save_failed', {
        error: error.message || String(error),
      })
    }
    this.update()
  }

  jumpToPage(page, focus = FOCUS.List) {
    this.state.overlay = null
    this.state.focus = focus
    if (this.state.page !== page) {
      this.state.page = page
      this.state.selected
        = page === PAGE.Preferences
          ? Math.max(
              0,
              preferenceItems().findIndex(
                item => item.kind === 'language' && item.id === this.state.language,
              ),
            )
          : 0
      this.state.detailScroll = 0
      this.state.search = ''
    }
    this.clampSelection()
    this.update()
  }

  changePage(delta, focus = FOCUS.List) {
    this.jumpToPage(
      PAGE_ORDER[moveIndex(PAGE_ORDER.indexOf(this.state.page), delta, PAGE_ORDER.length)],
      focus,
    )
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
      this.state.detailScroll = Math.max(
        0,
        Math.min(this.#detailMaxScroll, this.state.detailScroll + delta),
      )
      this.update()
    }
  }

  moveFocus(delta) {
    const seq = focusSeq()
    this.state.focus
      = seq[Math.max(0, Math.min(seq.length - 1, seq.indexOf(this.state.focus) + delta))]
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
    const selection = captureSelection(this)
    this.state.consoleTasks = this.state.consoleTasks.filter(
      task => task.status === 'pending' || task.status === 'running',
    )
    restoreSelection(this, selection)
    this.update()
  }

  visibleItems() {
    const { page, snapshot, search, commands } = this.state
    const matches = (...fields) =>
      fields.some(field => containsCaseInsensitive(field || '', search))
    switch (page) {
      case PAGE.Dashboard:
        return []
      case PAGE.Tools:
        return search
          ? snapshot.tools.filter(item => matches(item.name, item.version))
          : snapshot.tools
      case PAGE.Updates:
        return search
          ? snapshot.updates.filter(item => matches(item.name, item.current))
          : snapshot.updates
      case PAGE.Tasks:
        return search
          ? snapshot.tasks.filter(item => matches(item.name, item.description))
          : snapshot.tasks
      case PAGE.Config:
        return search
          ? snapshot.configs.filter(item => matches(item.path, item.tools.join(' ')))
          : snapshot.configs
      case PAGE.Console:
        return search
          ? this.state.consoleTasks.filter(item => matches(item.label, item.command, item.output))
          : this.state.consoleTasks
      case PAGE.Logs:
        return search
          ? this.state.logs.filter(item => matches(item.command, item.output))
          : this.state.logs
      case PAGE.Environment:
      case PAGE.System:
        return filterCommands(
          commands.filter(item => commandBelongsToPage(page, item.name)),
          search,
        )
      case PAGE.Preferences:
        return preferenceItems()
      default:
        return []
    }
  }

  selectedTool() {
    return this.state.page === PAGE.Tools ? this.visibleItems()[this.state.selected] || null : null
  }

  selectedUpdate() {
    return this.state.page === PAGE.Updates
      ? this.visibleItems()[this.state.selected] || null
      : null
  }

  selectedTask() {
    return this.state.page === PAGE.Tasks ? this.visibleItems()[this.state.selected] || null : null
  }

  selectedConfig() {
    return this.state.page === PAGE.Config
      ? this.visibleItems()[this.state.selected] || null
      : null
  }

  selectedLog() {
    return this.state.page === PAGE.Logs ? this.visibleItems()[this.state.selected] || null : null
  }

  selectedPageCommand() {
    return [PAGE.Environment, PAGE.System].includes(this.state.page)
      ? this.visibleItems()[this.state.selected] || null
      : null
  }

  currentListLen() {
    return this.visibleItems().length
  }

  clampSelection() {
    const len = this.currentListLen()
    this.state.selected = Math.max(0, Math.min(this.state.selected, len - 1))
    if (!len)
      this.state.detailScroll = 0
  }
}
