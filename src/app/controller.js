import { createJobRunner } from '../../vendor/lazy-kit/jobs.js'
import { DEFAULT_THEME } from '../../vendor/lazy-kit/themes.js'
import { t } from '../config/i18n.js'
import { loadSettings, saveSettings } from '../config/settings.js'
import {
  commandBelongsToPage,
  commandCatalog,
  createProjectConfigFile,
  globalConfigPath,
  loadSnapshot,
  projectConfigTarget,
  validateConfigTarget,
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
  openSettings,
  runPageCommand,
  selectConfigTarget,
  showHelp,
  toggleSearch,
  useSelectedVersion,
} from './overlays.js'
import { captureSelection, restoreSelection } from './selection.js'
import {
  containsCaseInsensitive,
  emptyPosition,
  filterCommands,
  FOCUS,
  focusSeq,
  GROUPS,
  moveIndex,
  PAGE,
  PAGE_ORDER,
  pageGroup,
  TOOL_SCOPE,
} from './state.js'

export class Application {
  #render
  #exit
  #dying = false
  #refreshVersion = 0
  #detailMaxScroll = 0
  #listCapacity = 0
  #detailCapacity = 0
  projectConfigMissing = false

  constructor(render, exit) {
    this.#render = render
    this.#exit = exit
    this.state = {
      page: PAGE.Dashboard,
      focus: FOCUS.Group4,
      focusedGroup: 3,
      groupTabs: [PAGE.Tools, PAGE.Tasks, PAGE.Environment, PAGE.Dashboard],
      pagePositions: Object.fromEntries(PAGE_ORDER.map(page => [page, emptyPosition()])),
      listStart: 0,
      configTarget: null,
      toolScope: TOOL_SCOPE.Project,
      toolScopePositions: {
        project: emptyPosition(),
        global: emptyPosition(),
      },
      language: 'en',
      theme: DEFAULT_THEME,
      snapshot: { mise_version: '—', tools: [], projectTools: [], globalTools: [], updates: [], tasks: [], configs: [] },
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
      jobs: [],
      dismissedJobs: new Set(),
    }
    this.runner = createJobRunner({
      onPatch: () => {
        this.state.jobs = this.runner.list()
        this.update()
      },
    })
    this.state.jobs = this.runner.list()
  }

  /** Shutdown hook: abort every in-flight job before the renderer tears down. */
  async close() {
    this.#dying = true
    this.#refreshVersion++
    await this.runner.abortAll()
  }

  update() {
    if (this.#dying)
      return
    const viewport = this.#render(this.state, this)
    if (viewport) {
      this.state.width = viewport.width
      this.state.height = viewport.height
      if (viewport.listCapacity != null)
        this.#listCapacity = viewport.listCapacity
      if (viewport.detailCapacity != null)
        this.#detailCapacity = viewport.detailCapacity
      if (viewport.detailMaxScroll != null) {
        this.#detailMaxScroll = viewport.detailMaxScroll
        this.state.detailScroll = Math.min(this.state.detailScroll, this.#detailMaxScroll)
      }
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
        this.state.configTarget = projectConfigTarget(this.state.snapshot.configs)
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
    if (this.#dying)
      return false
    const version = ++this.#refreshVersion
    try {
      const snapshot = await loadSnapshot()
      if (version !== this.#refreshVersion || this.#dying)
        return false
      const selections = PAGE_ORDER.map(page => [page, captureSelection(this, this.pageState(page))])
      this.state.snapshot = snapshot
      const names = new Set(snapshot.updates.map(item => item.name))
      for (const name of this.state.selectedUpdates) {
        if (!names.has(name))
          this.state.selectedUpdates.delete(name)
      }
      for (const [page, selection] of selections) {
        const position = this.pageState(page)
        restoreSelection(this, selection, position)
        if (page !== this.state.page) {
          this.state.pagePositions[page] = {
            selected: position.selected,
            search: position.search,
            detailScroll: position.detailScroll,
            listStart: position.listStart,
            selectionKey: captureSelection(this, position),
          }
        }
      }
      this.state.status = ''
      this.update()
      return true
    }
    catch (error) {
      if (version !== this.#refreshVersion || this.#dying)
        return false
      this.state.status = t(this.state.language, 'snapshot_load_failed', {
        error: error.message || String(error),
      })
      this.update()
      return false
    }
  }

  handleKey(key) {
    if (key.name === 'return')
      key = { ...key, name: 'enter' }
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
        this.moveVertical(this.#halfPage())
      else if (name === 'u')
        this.moveVertical(-this.#halfPage())
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
        if (this.state.focus === FOCUS.Details)
          return
        this.activateFocusedPage()
        toggleSearch(this)
        return
      case 'r':
        void this.refresh()
        return
      case ':':
        openSettings(this)
        return
      case 'L':
        this.#toggleLanguage()
        return
      case 'x':
        this.#abortNewest()
        return
      case '1':
      case '2':
      case '3':
      case '4':
        this.focusGroup(Number(name) - 1)
        return
      case '0':
        this.state.focus = FOCUS.Details
        this.update()
        return
      case '[':
      case ']':
        this.changePage(name === '[' ? -1 : 1)
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
      case 'backtab':
        this.cycleFocus(shift || name === 'backtab' ? -1 : 1)
        return
      case 'g':
      case 'home':
        this.#goTop()
        return
      case 'G':
      case 'end':
        this.#goBottom()
        return
      case 'pageup':
        this.moveVertical(-this.#halfPage())
        return
      case 'pagedown':
        this.moveVertical(this.#halfPage())
        return
      case 'escape':
        this.focusGroup(this.state.focusedGroup)
        return
      case 'return':
      case 'enter':
        this.moveFocus(1)
        return
    }
    // Only the focused group's real list receives action keys.
    if (this.state.focus === FOCUS.Details)
      return
    if (!['a', 'A', 'f2', 'm', 'M', 'i', 'I', 'D', 'space', 'u', 'U', 'R', 'n', 's', 'e', 'y'].includes(name))
      return
    this.activateFocusedPage()
    switch (name) {
      case 'a':
        void openRegistry(this)
        return
      case 'A':
        openCustomTool(this)
        return
      case 'f2':
        openConfigTarget(this)
        return
      case 'm':
        openContextCommands(this)
        return
      case 'M':
        openCommandPalette(this)
        return
    }
    this.#handlePageKey(name)
  }

  #handlePageKey(name) {
    switch (this.state.page) {
      case PAGE.Tools:
        if (name === 's')
          this.switchToolScope()
        else if (name === 'I')
          void useSelectedVersion(this)
        else if (name === 'i')
          void installSelectedVersion(this)
        else if (name === 'D')
          void this.deleteSelectedTool()
        break
      case PAGE.Updates:
        if (name === 'space')
          this.toggleSelectedUpdate()
        else if (name === 'u')
          void this.upgradeSelected()
        else if (name === 'U')
          void this.upgradeSelected(true)
        break
      case PAGE.Tasks:
        if (name === 'R')
          void this.runSelectedTask()
        break
      case PAGE.Environment:
      case PAGE.System:
        if (name === 'R')
          void runPageCommand(this)
        break
      case PAGE.Config:
        if (name === 'n')
          this.createProjectConfig()
        else if (name === 's')
          selectConfigTarget(this)
        else if (name === 'e')
          void this.openConfig()
        else if (name === 'y')
          copySelectedConfig(this)
        break
      case PAGE.Console:
        if (name === 'D')
          this.#dismissConsoleTasks()
        break
      case PAGE.Logs:
      case PAGE.Dashboard:
        break
    }
  }

  #quit() {
    const active = this.state.jobs.filter(
      job => job.state === 'queued' || job.state === 'running',
    )
    if (active.length) {
      this.state.overlay = {
        type: 'Quit',
        parent: null,
        scroll: 0,
        message: t(this.state.language, 'jobs still running: {count}', { count: active.length }),
        onConfirm: () => {
          this.#dying = true
          this.#exit(0)
        },
      }
      this.update()
      return
    }
    this.#dying = true
    this.#exit(0)
  }

  #halfPage() {
    const capacity = this.state.focus === FOCUS.Details ? this.#detailCapacity : this.#listCapacity
    return Math.max(1, Math.floor(capacity / 2))
  }

  #abortNewest() {
    const active = [...this.state.jobs]
      .reverse()
      .find(job => job.state === 'queued' || job.state === 'running')
    if (active)
      this.runner.abort(active.id)
  }

  #toggleLanguage() {
    const language = this.state.language === 'zh' ? 'en' : 'zh'
    try {
      saveSettings({ language, theme: this.state.theme })
      this.state.language = language
    }
    catch (error) {
      this.state.status = t(this.state.language, 'settings_save_failed', {
        error: error.message || String(error),
      })
    }
    this.update()
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

  createProjectConfig() {
    this.state.overlay = {
      type: 'ConfirmCommand',
      parent: null,
      scroll: 0,
      message: t(this.state.language, 'config_project_create', { path: process.cwd() }),
      onConfirm: () => {
        try {
          const target = createProjectConfigFile()
          this.setConfigTarget(target)
          if (!this.state.snapshot.configs.some(config => config.path === target.path))
            this.state.snapshot.configs.push({ path: target.path, tools: [] })
          this.projectConfigMissing = false
          this.state.search = ''
          this.state.selected = this.state.snapshot.configs.findIndex(config => config.path === target.path)
          this.state.detailScroll = 0
          this.clampSelection()
          this.state.status = t(this.state.language, 'config_project_created', { path: target.path })
        }
        catch (error) {
          this.state.status = t(this.state.language, 'config_project_failed', {
            error: error.message || String(error),
          })
        }
        this.update()
      },
    }
    this.update()
  }

  async openConfig() {
    const config = this.selectedConfig()
    if (config)
      await executeCommand(this, ['edit', config.path], true)
  }

  setConfigTarget(target) {
    const scope = target.path === globalConfigPath() ? TOOL_SCOPE.Global : TOOL_SCOPE.Project
    if (scope !== this.state.toolScope)
      this.restoreToolScope(scope)
    this.state.configTarget = target
    this.clampSelection()
  }

  restoreToolScope(scope) {
    const position = this.pageState(PAGE.Tools)
    const { selected, detailScroll, search, listStart } = position
    this.state.toolScopePositions[this.state.toolScope] = {
      selected,
      detailScroll,
      search,
      listStart,
      selectionKey: captureSelection(this, position),
    }
    const next = this.state.toolScopePositions[scope]
    this.state.toolScope = scope
    if (this.state.page === PAGE.Tools) {
      const { selected, detailScroll, search, listStart } = next
      Object.assign(this.state, { selected, detailScroll, search, listStart })
      if (next.selectionKey !== undefined)
        restoreSelection(this, next.selectionKey)
    }
    else {
      this.state.pagePositions[PAGE.Tools] = { ...next }
    }
    this.clampSelection()
  }

  switchToolScope() {
    const scope = this.state.toolScope === TOOL_SCOPE.Project ? TOOL_SCOPE.Global : TOOL_SCOPE.Project
    this.restoreToolScope(scope)
    // Clear the old target before resolving: failures must never write to the other scope.
    this.state.configTarget = null
    try {
      this.state.configTarget = scope === TOOL_SCOPE.Global
        ? validateConfigTarget(globalConfigPath(), true)
        : projectConfigTarget(this.state.snapshot.configs)
      this.state.status = ''
    }
    catch (error) {
      this.state.status = t(this.state.language, 'config_target_invalid', {
        error: error.message || String(error),
      })
    }
    this.update()
  }

  /** Focus is independent from the page currently displayed on the right. */
  focusGroup(index) {
    this.state.focusedGroup = index
    this.state.focus = GROUPS[index].id
    this.update()
  }

  pageState(page) {
    if (page === this.state.page)
      return this.state
    const saved = this.state.pagePositions[page]
    const position = { ...this.state, ...saved, page }
    if (saved.selectionKey !== undefined) {
      restoreSelection(this, saved.selectionKey, position)
      Object.assign(saved, {
        selected: position.selected,
        detailScroll: position.detailScroll,
        selectionKey: captureSelection(this, position),
      })
    }
    return position
  }

  savePagePosition() {
    const { page, selected, search, detailScroll, listStart } = this.state
    this.state.pagePositions[page] = {
      selected,
      search,
      detailScroll,
      listStart,
      selectionKey: captureSelection(this),
    }
  }

  activatePage(page) {
    if (page !== this.state.page) {
      this.savePagePosition()
      const { selected, search, detailScroll, listStart } = this.pageState(page)
      Object.assign(this.state, { selected, search, detailScroll, listStart, page })
    }
    this.clampSelection()
  }

  activateFocusedPage() {
    if (this.state.focus !== FOCUS.Details)
      this.activatePage(this.state.groupTabs[this.state.focusedGroup])
  }

  jumpToPage(page, focus = GROUPS[pageGroup(page)].id) {
    this.state.overlay = null
    const group = pageGroup(page)
    this.state.groupTabs[group] = page
    this.state.focusedGroup = group
    this.state.focus = focus
    this.activatePage(page)
    this.update()
  }

  changePage(delta) {
    const index = this.state.focusedGroup
    const pages = GROUPS[index].pages
    const page = pages[moveIndex(pages.indexOf(this.state.groupTabs[index]), delta, pages.length)]
    this.state.groupTabs[index] = page
    this.activatePage(page)
    this.update()
  }

  cycleFocus(delta) {
    const seq = focusSeq()
    const focus = seq[moveIndex(seq.indexOf(this.state.focus), delta, seq.length)]
    if (focus === FOCUS.Details) {
      this.state.focus = focus
      this.update()
    }
    else {
      this.focusGroup(seq.indexOf(focus))
    }
  }

  moveVertical(delta) {
    if (this.state.focus !== FOCUS.Details) {
      this.activateFocusedPage()
      this.state.selected = Math.max(0, Math.min(this.currentListLen() - 1, this.state.selected + delta))
      this.state.detailScroll = 0
      this.clampSelection()
    }
    else {
      this.state.detailScroll = Math.max(
        0,
        Math.min(this.#detailMaxScroll, this.state.detailScroll + delta),
      )
    }
    this.update()
  }

  moveFocus(delta) {
    if (delta < 0) {
      if (this.state.focus === FOCUS.Details)
        this.focusGroup(this.state.focusedGroup)
    }
    else if (this.state.focus !== FOCUS.Details) {
      this.activateFocusedPage()
      this.state.focus = FOCUS.Details
      this.update()
    }
  }

  #goTop() {
    if (this.state.focus !== FOCUS.Details) {
      this.activateFocusedPage()
      this.state.selected = 0
    }
    this.state.detailScroll = 0
    this.update()
  }

  #goBottom() {
    if (this.state.focus !== FOCUS.Details) {
      this.activateFocusedPage()
      this.state.selected = Math.max(0, this.currentListLen() - 1)
      this.state.detailScroll = 0
    }
    else {
      this.state.detailScroll = this.#detailMaxScroll
    }
    this.update()
  }

  #dismissConsoleTasks() {
    const selection = captureSelection(this)
    for (const job of this.state.jobs) {
      if (job.state !== 'queued' && job.state !== 'running')
        this.state.dismissedJobs.add(job.id)
    }
    restoreSelection(this, selection)
    this.update()
  }

  visibleItems(state = this.state) {
    const { page, snapshot, search, commands } = state
    const matches = (...fields) =>
      fields.some(field => containsCaseInsensitive(field || '', search))
    switch (page) {
      case PAGE.Dashboard:
        return []
      case PAGE.Tools: {
        const tools = state.toolScope === TOOL_SCOPE.Global
          ? snapshot.globalTools
          : snapshot.projectTools
        return search ? tools.filter(item => matches(item.name, item.version)) : tools
      }
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
      case PAGE.Console: {
        const jobs = state.jobs.filter(job => !state.dismissedJobs.has(job.id))
        return search ? jobs.filter(item => matches(item.label, item.state, item.lastLine)) : jobs
      }
      case PAGE.Logs:
        return search
          ? state.logs.filter(item => matches(item.command, item.output))
          : state.logs
      case PAGE.Environment:
      case PAGE.System:
        return filterCommands(
          commands.filter(item => commandBelongsToPage(page, item.name)),
          search,
        )
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
