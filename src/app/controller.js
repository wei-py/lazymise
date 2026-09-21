import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { t } from '../config/i18n.js'
import { loadSettings, saveSettings } from '../config/settings.js'
import {
  commandBelongsToPage,
  commandCatalog,
  commandHelp,
  DASHBOARD_COMMANDS,
  execute,
  isInteractive,
  loadSnapshot,
  needsConfirmation,
  registry,
  remoteVersions,
} from '../mise.js'
import {
  containsCaseInsensitive,
  FOCUS,
  focusSeq,
  moveIndex,
  PAGE,
  PAGE_ORDER,
  SCOPE,
  VERSION_INTENT,
} from './state.js'

export class Application {
  #render
  #exit
  #dying

  constructor(render, exit) {
    this.#render = render
    this.#exit = exit
    this.#dying = false
    this.state = {
      page: PAGE.Dashboard,
      focus: FOCUS.Navigation,
      scope: SCOPE.Project,
      language: 'en',
      snapshot: {
        mise_version: '—',
        tools: [],
        updates: [],
        tasks: [],
        configs: [],
      },
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

  // ---- lifecycle ----

  update() {
    this.#render(this.state, this)
  }

  async start() {
    const settings = loadSettings()
    this.state.language = settings.language
    this.update()
    await this.refresh()
    try {
      this.state.commands = await commandCatalog()
    }
    catch {
      this.state.commands = []
    }
    this.state.loading = false
    this.update()
  }

  async refresh() {
    try {
      this.state.snapshot = await loadSnapshot()
      this.state.status = ''
    }
    catch {
      this.state.status = t(this.state.language, 'error_load_failed')
    }
    this.clampSelection()
    this.update()
  }

  // ---- key dispatch ----

  handleKey(key) {
    if (this.#dying)
      return

    // overlay active? delegate
    if (this.state.overlay) {
      this.handleOverlayKey(key)
      return
    }

    const { name, ctrl, shift, text } = key

    // Ctrl-c = quit
    if (ctrl && name === 'c') { this.#quit(); return }

    // basic keys
    switch (name) {
      case 'q': this.#quit(); return
      case '?': this.showHelp(); return
      case '/': this.toggleSearch(); return
      case 'r': void this.refresh(); return
      case 'p': this.setScope(SCOPE.Project); return
      case 'G': this.setScope(SCOPE.Global); return
      case 'a': void this.openRegistry(); return
      case 'A': this.openCustomTool(); return
      case ':': this.openCommandPalette(); return
      case 'm': this.openContextCommands(); return
    }

    // page jump
    switch (name) {
      case '1':
      case 'g': this.jumpToPage(PAGE.Dashboard); return
      case '2': this.jumpToPage(PAGE.Tools); return
      case '3':
      case 'u': this.jumpToPage(PAGE.Updates); return
      case '4':
      case 't': this.jumpToPage(PAGE.Tasks); return
      case 'b': this.jumpToPage(PAGE.Console); return
      case '5':
      case 'E': this.jumpToPage(PAGE.Environment); return
      case '6':
      case 'c': this.jumpToPage(PAGE.Config); return
      case '7':
      case 's': this.jumpToPage(PAGE.System); return
      case '8':
      case 'o': this.jumpToPage(PAGE.Preferences); return
      case 'x': this.jumpToPage(PAGE.Logs); return
      case '[': this.changePage(-1); return
      case ']': this.changePage(1); return
    }

    // navigation
    switch (name) {
      case 'h':
      case 'left': this.moveFocus(-1); return
      case 'l':
      case 'right': this.moveFocus(1); return
      case 'j':
      case 'down': this.moveVertical(1); return
      case 'k':
      case 'up': this.moveVertical(-1); return
      case 'tab':
        if (shift)
          this.cycleFocus(-1)
        else this.cycleFocus(1)
        return
      case 'home': this.#goTop(); return
      case 'end': this.#goBottom(); return
    }

    // ctrl + d/u = page scroll
    if (ctrl && name === 'd') { this.moveVertical(5); return }
    if (ctrl && name === 'u') { this.moveVertical(-5); return }

    // escape = back to nav
    if (name === 'escape') {
      this.state.focus = FOCUS.Navigation
      this.update()
      return
    }

    // page-specific
    this.#handlePageKey(name, _ctrl, _shift)

    // printable text in navigation/search context
    if (text && text.length === 1 && !ctrl && !shift && name !== 'escape') {
      // if any printable character is pressed, start search with that character
      this.state.overlay = { type: 'Search', previousSearch: this.state.search }
      this.state.search = text
      this.state.selected = 0
      this.clampSelection()
      this.update()
    }
  }

  #handlePageKey(name, _ctrl, _shift) {
    const { page } = this.state
    switch (page) {
      case PAGE.Tools:
        switch (name) {
          case 'v': void this.useSelectedVersion(); return
          case 'i': void this.installSelectedVersion(); return
          case 'd': void this.deleteSelectedTool(); return
          case 'enter': void this.runPageCommand()
        }
        break
      case PAGE.Updates:
        switch (name) {
          case 'space': this.toggleSelectedUpdate(); return
          case 'U': void this.upgradeSelected()
        }
        break
      case PAGE.Tasks: {
        const task = this.selectedTask()
        if (name === 'enter' && task) { void this.runSelectedTask() }
        break
      }
      case PAGE.Environment:
      case PAGE.System:
        if (name === 'enter') { void this.runPageCommand() }
        break
      case PAGE.Console:
        if (name === 'd') { this.#dismissConsoleTasks() }
        break
      case PAGE.Config:
        if (name === 'e') { void this.openConfig(); return }
        if (name === 'y') { void this.#copySelectedConfig() }
        break
      case PAGE.Preferences:
        if (name === 'enter') { void this.toggleLanguage() }
        break
      case PAGE.Logs: {
        const log = this.selectedLog()
        if (name === 'enter' && log) { void log }
        break
      }
      case PAGE.Dashboard:
        if (name === 'enter') { void this.runPageCommand() }
        break
    }
  }

  #quit() {
    this.#dying = true
    this.#exit(0)
  }

  // ---- overlay routing ----

  handleOverlayKey(key) {
    const ov = this.state.overlay
    if (!ov)
      return
    switch (ov.type) {
      case 'Search': this.handleSearchKey(key); return
      case 'Help': this.#handleHelpKey(_key); return
      case 'Picker': this.handlePickerKey(key); return
      case 'CommandPalette': this.handleCommandPaletteKey(key); return
      case 'CommandBuilder': this.handleCommandBuilderKey(key); return
      case 'CustomTool': this.handleCustomToolKey(key); return
      case 'ConfirmDelete':
      case 'ConfirmCommand': this.handleConfirmKey(key)
    }
  }

  // ---- search ----

  toggleSearch() {
    this.state.overlay = { type: 'Search', previousSearch: this.state.search }
    this.update()
  }

  handleSearchKey(key) {
    const { name, ctrl, shift, text } = key
    if (ctrl && name === 'c') { this.#closeOverlay(); return }

    switch (name) {
      case 'enter':
        // apply search — stay on current search text, close overlay
        this.#closeOverlay()
        this.clampSelection()
        this.update()
        return
      case 'escape':
        this.state.search = ''
        this.state.selected = 0
        this.#closeOverlay()
        this.update()
        return
      case 'backspace':
        this.state.search = this.state.search.slice(0, -1)
        this.state.selected = 0
        this.clampSelection()
        this.update()
        return
    }

    // printable
    if (text && text.length === 1 && !ctrl && !shift) {
      this.state.search += text
      this.state.selected = 0
      this.clampSelection()
      this.update()
    }
  }

  #handleHelpKey(_key) {
    // any key closes help
    this.#closeOverlay()
    this.update()
  }

  // ---- picker (registry → backend → version) ----

  async openRegistry() {
    this.state.status = t(this.state.language, 'loading_registry')
    this.update()
    try {
      const tools = await registry()
      // collect unique backends
      const backendSet = new Set()
      for (const t of tools) {
        for (const b of t.backends) backendSet.add(b)
      }
      const backends = ['All', ...Array.from(backendSet).sort()]
      this.state.overlay = {
        type: 'Picker',
        level: 'registry',
        tools,
        backends,
        filterIdx: 0,
        selected: 0,
        search: '',
        intent: VERSION_INTENT.Use,
      }
      this.state.status = ''
    }
    catch {
      this.state.status = t(this.state.language, 'error_load_failed')
    }
    this.update()
  }

  async #openBackends() {
    const ov = this.state.overlay
    const tool = ov.tools[ov.selected]
    if (!tool)
      return
    if (!tool.backends || tool.backends.length === 0) {
      // no backends — go straight to versions
      await this.#openVersions(tool.name)
      return
    }
    if (tool.backends.length === 1) {
      // single backend — use it and go to versions
      const fullName = `${tool.backends[0]}:${tool.name}`
      await this.#openVersions(fullName)
      return
    }
    // multiple backends — show backend picker
    ov.level = 'backends'
    ov.selectedTool = tool
    ov.backendList = tool.backends
    ov.backendSelected = 0
    this.update()
  }

  async #openVersions(toolName) {
    const ov = this.state.overlay
    ov.level = 'versions'
    ov.selected = 0
    ov.statusText = t(this.state.language, 'loading_versions')
    ov.versions = []
    this.update()
    try {
      ov.versions = await remoteVersions(toolName)
      ov.statusText = ''
    }
    catch {
      ov.statusText = t(this.state.language, 'error_load_failed')
      ov.versions = []
    }
    this.update()
  }

  handlePickerKey(key) {
    const ov = this.state.overlay
    const { name, ctrl, shift, text } = key

    if (ctrl && name === 'c') { this.#closeOverlay(); return }

    if (ov.level === 'registry') {
      switch (name) {
        case 'tab': {
          const len = ov.backends.length
          const delta = shift ? -1 : 1
          ov.filterIdx = ((ov.filterIdx + delta) % len + len) % len
          ov.selected = 0
          this.update()
          return
        }
        case '/':
          // toggle search mode inside picker
          ov.searching = !ov.searching
          if (!ov.searching)
            ov.search = ''
          this.update()
          return
        case 'escape':
          this.#closeOverlay()
          this.update()
          return
        case 'enter': {
          const filtered = this.#pickerFiltered(ov)
          if (filtered.length === 0)
            return
          ov.selectedTool = filtered[ov.selected]
          void this.#openBackends()
          return
        }
        case 'j':
        case 'down': {
          const items = this.#pickerFiltered(ov)
          ov.selected = moveIndex(ov.selected, 1, items.length || 1)
          this.update()
          return
        }
        case 'k':
        case 'up': {
          const items = this.#pickerFiltered(ov)
          ov.selected = moveIndex(ov.selected, -1, items.length || 1)
          this.update()
          return
        }
        case 'backspace':
          if (ov.searching && ov.search.length > 0) {
            ov.search = ov.search.slice(0, -1)
            ov.selected = 0
            this.update()
          }
          return
      }
      if (ov.searching && text && text.length === 1 && !ctrl && !shift) {
        ov.search += text
        ov.selected = 0
        this.update()
      }
      return
    }

    if (ov.level === 'backends') {
      const list = ov.backendList || []
      switch (name) {
        case 'escape':
          ov.level = 'registry'
          ov.selected = ov.tools.indexOf(ov.selectedTool)
          if (ov.selected < 0)
            ov.selected = 0
          this.update()
          return
        case 'enter': {
          const backend = list[ov.backendSelected]
          if (!backend)
            return
          const fullName = `${backend}:${ov.selectedTool.name}`
          void this.#openVersions(fullName)
          return
        }
        case 'j':
        case 'down':
          ov.backendSelected = moveIndex(ov.backendSelected, 1, list.length || 1)
          this.update()
          return
        case 'k':
        case 'up':
          ov.backendSelected = moveIndex(ov.backendSelected, -1, list.length || 1)
          this.update()
          return
      }
      return
    }

    if (ov.level === 'versions') {
      const versions = ov.versions || []
      switch (name) {
        case 'escape':
          // go back to previous level
          if (ov.selectedTool) {
            // was at backends or registry — go back
            if (ov.backendList && ov.backendList.length > 1) {
              ov.level = 'backends'
              this.update()
            }
            else {
              ov.level = 'registry'
              ov.selected = ov.tools.indexOf(ov.selectedTool)
              if (ov.selected < 0)
                ov.selected = 0
              this.update()
            }
          }
          else {
            ov.level = 'registry'
            this.update()
          }
          return
        case 'enter': {
          const version = versions[ov.selected]
          if (!version)
            return
          const intent = ov.intent || VERSION_INTENT.Use
          // build tool@version spec
          let toolSpec = version.version
          // resolve the full tool name
          if (ov.selectedTool) {
            const st = ov.selectedTool
            if (st.backends && st.backends.length === 1) {
              toolSpec = `${st.backends[0]}:${st.name}@${version.version}`
            }
            else if (st.backends && st.backends.length > 1 && ov.backendList) {
              const backend = ov.backendList[ov.backendSelected] || st.backends[0]
              toolSpec = `${backend}:${st.name}@${version.version}`
            }
            else {
              toolSpec = `${st.name}@${version.version}`
            }
          }
          this.#closeOverlay()
          if (intent === VERSION_INTENT.Use) {
            const scopeFlag = this.state.scope === SCOPE.Global ? ['--global'] : []
            this.executeBackground(['use', '--yes', ...scopeFlag, toolSpec], `use ${toolSpec}`)
          }
          else {
            this.executeBackground(['install', '--yes', toolSpec], `install ${toolSpec}`)
          }
          return
        }
        case 'j':
        case 'down':
          ov.selected = moveIndex(ov.selected, 1, versions.length || 1)
          this.update()
          return
        case 'k':
        case 'up':
          ov.selected = moveIndex(ov.selected, -1, versions.length || 1)
          this.update()
      }
    }
  }

  #pickerFiltered(ov) {
    if (!ov.tools)
      return []
    let filtered = ov.tools
    // filter by search
    if (ov.search) {
      const q = ov.search.toLowerCase()
      filtered = filtered.filter(t =>
        t.name.toLowerCase().includes(q)
        || (t.description && t.description.toLowerCase().includes(q)),
      )
    }
    // filter by backend
    if (ov.filterIdx > 0 && ov.backends) {
      const backend = ov.backends[ov.filterIdx]
      filtered = filtered.filter(t => t.backends && t.backends.includes(backend))
    }
    return filtered
  }

  // ---- command palette ----

  openCommandPalette() {
    this.state.overlay = {
      type: 'CommandPalette',
      commands: this.state.commands,
      selected: 0,
      search: '',
      searching: false,
    }
    this.update()
  }

  openContextCommands() {
    const page = this.state.page
    const filtered = this.state.commands.filter(c =>
      commandBelongsToPage(page, c.name) || DASHBOARD_COMMANDS.includes(c.name),
    )
    this.state.overlay = {
      type: 'CommandPalette',
      commands: filtered,
      selected: 0,
      search: '',
      searching: false,
      context: true,
    }
    this.update()
  }

  handleCommandPaletteKey(key) {
    const ov = this.state.overlay
    const { name, ctrl, shift, text } = key

    if (ctrl && name === 'c') { this.#closeOverlay(); return }

    if (ov.searching) {
      switch (name) {
        case 'enter':
          ov.searching = false
          ov.selected = 0
          this.update()
          return
        case 'escape':
          ov.search = ''
          ov.searching = false
          ov.selected = 0
          this.update()
          return
        case 'backspace':
          ov.search = ov.search.slice(0, -1)
          ov.selected = 0
          this.update()
          return
      }
      if (text && text.length === 1 && !ctrl && !shift) {
        ov.search += text
        ov.selected = 0
        this.update()
      }
      return
    }

    // not searching
    const filtered = this.#commandFiltered(ov)
    switch (name) {
      case 'escape':
      case 'q':
        this.#closeOverlay()
        this.update()
        return
      case '/':
        ov.searching = true
        this.update()
        return
      case 'enter': {
        const cmd = filtered[ov.selected]
        if (!cmd)
          return
        this.#openCommandBuilder(cmd)
        return
      }
      case 'j':
      case 'down':
        ov.selected = moveIndex(ov.selected, 1, filtered.length || 1)
        this.update()
        return
      case 'k':
      case 'up':
        ov.selected = moveIndex(ov.selected, -1, filtered.length || 1)
        this.update()
    }
  }

  #commandFiltered(ov) {
    if (!ov.commands)
      return []
    if (!ov.search)
      return ov.commands
    const q = ov.search.toLowerCase()
    return ov.commands.filter(c =>
      c.name.toLowerCase().includes(q)
      || (c.description && c.description.toLowerCase().includes(q)),
    )
  }

  async #openCommandBuilder(cmd) {
    const help = await commandHelp(cmd.name)
    this.state.overlay = {
      type: 'CommandBuilder',
      command: cmd,
      help,
      args: '',
      mode: 'input',
      scroll: 0,
    }
    this.update()
  }

  // ---- command builder ----

  handleCommandBuilderKey(key) {
    const ov = this.state.overlay
    const { name, ctrl, shift, text } = key

    if (ctrl && name === 'c') { this.#closeOverlay(); return }

    if (ov.mode === 'input') {
      switch (name) {
        case 'escape':
          this.#closeOverlay()
          this.update()
          return
        case 'enter': {
          const cmd = ov.command
          const args = ov.args.trim() ? ov.args.trim().split(/\s+/) : []
          this.#closeOverlay()
          if (needsConfirmation(cmd.name)) {
            this.#confirmCommand(cmd.name, [...args])
          }
          else {
            void this.executeCommand([cmd.name, ...args], false)
          }
          return
        }
        case 'tab':
          ov.mode = 'help'
          this.update()
          return
        case 'backspace':
          ov.args = ov.args.slice(0, -1)
          this.update()
          return
        case 'space':
          ov.args += ' '
          this.update()
          return
      }
      if (text && text.length === 1 && !ctrl && !shift) {
        ov.args += text
        this.update()
      }
      return
    }

    // help viewport mode
    if (ov.mode === 'help') {
      switch (name) {
        case 'escape':
          this.#closeOverlay()
          this.update()
          return
        case 'tab':
        case 'enter':
          ov.mode = 'input'
          this.update()
          return
        case 'j':
        case 'down':
          ov.scroll = Math.max(0, ov.scroll + 1)
          this.update()
          return
        case 'k':
        case 'up':
          ov.scroll = Math.max(0, ov.scroll - 1)
          this.update()
          return
        case 'h':
        case 'left':
          ov.scroll = Math.max(0, ov.scroll - 1)
          this.update()
          return
        case 'l':
        case 'right':
          ov.scroll = Math.max(0, ov.scroll + 1)
          this.update()
          return
        case 'pageup':
        case 'pagedown': {
          const delta = name === 'pagedown' ? 10 : -10
          ov.scroll = Math.max(0, ov.scroll + delta)
          this.update()
          return
        }
        case 'g':
        case 'home':
          ov.scroll = 0
          this.update()
          return
        case 'G':
        case 'end':
          ov.scroll = Number.MAX_SAFE_INTEGER
          this.update()
      }
    }
  }

  // ---- custom tool ----

  openCustomTool() {
    this.state.overlay = {
      type: 'CustomTool',
      input: '',
      scope: this.state.scope,
    }
    this.update()
  }

  handleCustomToolKey(key) {
    const ov = this.state.overlay
    const { name, ctrl, shift, text } = key

    if (ctrl && name === 'c') { this.#closeOverlay(); return }

    switch (name) {
      case 'escape':
        this.#closeOverlay()
        this.update()
        return
      case 'enter': {
        const spec = ov.input.trim()
        if (!spec)
          return
        this.#closeOverlay()
        const scopeFlag = ov.scope === SCOPE.Global ? ['--global'] : []
        this.executeBackground(['use', '--yes', ...scopeFlag, spec], `use ${spec}`)
        return
      }
      case 'tab':
        ov.scope = ov.scope === SCOPE.Project ? SCOPE.Global : SCOPE.Project
        this.update()
        return
      case 'backspace':
        ov.input = ov.input.slice(0, -1)
        this.update()
        return
      case 'space':
        ov.input += ' '
        this.update()
        return
    }
    if (text && text.length === 1 && !ctrl && !shift) {
      ov.input += text
      this.update()
    }
  }

  // ---- confirm ----

  #confirmCommand(cmdName, args) {
    this.state.overlay = {
      type: 'ConfirmCommand',
      command: cmdName,
      args,
      message: t(this.state.language, 'confirm_command', { command: [cmdName, ...args].join(' ') }),
    }
    this.update()
  }

  #confirmDelete(name, onConfirm) {
    this.state.overlay = {
      type: 'ConfirmDelete',
      name,
      message: t(this.state.language, 'confirm_delete', { name }),
      onConfirm,
    }
    this.update()
  }

  handleConfirmKey(key) {
    const ov = this.state.overlay
    const { name } = key

    switch (name) {
      case 'enter':
      case 'y': {
        const cb = ov.onConfirm
        const cmdName = ov.command
        const args = ov.args || []
        this.#closeOverlay()
        if (cb) { void cb(); return }
        if (cmdName) { void this.executeCommand([cmdName, ...args], false); return }
        this.update()
        return
      }
      case 'escape':
      case 'n':
      case 'q':
        this.#closeOverlay()
        this.update()
    }
  }

  // ---- execute ----

  async executeCommand(args, passthrough) {
    const cmdStr = args.join(' ')
    this.state.status = t(this.state.language, 'executing', { command: cmdStr })
    this.update()

    if (passthrough || isInteractive(args[0])) {
      // interactive: hand off to terminal
      try {
        const proc = Bun.spawn(['mise', ...args], {
          stdout: 'inherit',
          stderr: 'inherit',
          stdin: 'inherit',
        })
        await proc.exited
        this.finishCommand({
          command: `mise ${cmdStr}`,
          output: '',
          success: proc.exitCode === 0,
        })
      }
      catch {
        this.finishCommand({
          command: `mise ${cmdStr}`,
          output: err.message || String(err),
          success: false,
        })
      }
      return
    }

    try {
      const result = await execute(args)
      this.finishCommand(result)
    }
    catch {
      this.finishCommand({
        command: `mise ${cmdStr}`,
        output: err.message || String(err),
        success: false,
      })
    }
  }

  finishCommand(result) {
    this.state.logs.unshift({
      command: result.command || '',
      output: result.output || '',
      success: result.success !== false,
    })
    // keep max 100 log entries
    if (this.state.logs.length > 100)
      this.state.logs = this.state.logs.slice(0, 100)
    if (result.success) {
      this.state.status = t(this.state.language, 'command_success')
      void this.refresh()
    }
    else {
      this.state.status = t(this.state.language, 'command_failed', {
        error: result.output || 'unknown error',
      })
      this.update()
    }
  }

  // ---- background tasks ----

  executeBackground(args, label) {
    const task = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label,
      command: `mise ${args.join(' ')}`,
      status: 'pending',
      output: '',
      startTime: Date.now(),
      endTime: 0,
    }
    this.state.consoleTasks.unshift(task)
    if (this.state.consoleTasks.length > 100)
      this.state.consoleTasks = this.state.consoleTasks.slice(0, 100)
    this.update()

    const proc = Bun.spawn(['mise', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    task.status = 'running'
    this.update()

    // Read output asynchronously without blocking
    ;(async () => {
      try {
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ])
        task.output = (`${stdout}\n${stderr}`).trim()
        task.status = proc.exitCode === 0 ? 'done' : 'failed'
      }
      catch {
        task.output = err.message || String(err)
        task.status = 'failed'
      }
      finally {
        task.endTime = Date.now()
        this.update()
        // Also log to command history
        this.state.logs.unshift({
          command: task.command,
          output: task.output,
          success: task.status === 'done',
        })
        if (this.state.logs.length > 100)
          this.state.logs = this.state.logs.slice(0, 100)
      }
    })()
  }

  // ---- page actions ----

  async useSelectedVersion() {
    const tool = this.selectedTool()
    if (!tool)
      return
    this.state.overlay = null
    await this.openVersionsForAction(VERSION_INTENT.Use)
  }

  async installSelectedVersion() {
    const tool = this.selectedTool()
    if (!tool)
      return
    this.state.overlay = null
    await this.openVersionsForAction(VERSION_INTENT.Install)
  }

  async openVersionsForAction(intent) {
    const tool = this.selectedTool()
    if (!tool)
      return
    this.state.overlay = {
      type: 'Picker',
      level: 'versions',
      versions: [],
      selected: 0,
      intent,
      selectedTool: { name: tool.name, backends: [] },
      tools: [],
      backends: ['All'],
      filterIdx: 0,
      search: '',
      statusText: t(this.state.language, 'loading_versions'),
    }
    this.update()
    try {
      const versions = await remoteVersions(tool.name)
      this.state.overlay.versions = versions
      this.state.overlay.statusText = ''
    }
    catch {
      this.state.overlay.statusText = t(this.state.language, 'error_load_failed')
      this.state.overlay.versions = []
    }
    this.update()
  }

  async deleteSelectedTool() {
    const tool = this.selectedTool()
    if (!tool)
      return
    this.#confirmDelete(tool.name, () => {
      this.executeBackground(['uninstall', '--yes', tool.name], `uninstall ${tool.name}`)
    })
  }

  toggleSelectedUpdate() {
    const update = this.selectedUpdate()
    if (!update)
      return
    if (this.state.selectedUpdates.has(update.name)) {
      this.state.selectedUpdates.delete(update.name)
    }
    else {
      this.state.selectedUpdates.add(update.name)
    }
    this.update()
  }

  async upgradeSelected() {
    const updates = this.state.snapshot.updates || []
    const toUpgrade = this.state.selectedUpdates.size > 0
      ? updates.filter(u => this.state.selectedUpdates.has(u.name))
      : updates

    if (toUpgrade.length === 0)
      return

    const names = toUpgrade.map(u => u.name)
    this.state.overlay = {
      type: 'ConfirmCommand',
      command: 'upgrade',
      args: ['--yes', ...names],
      message: t(this.state.language, 'confirm_upgrade', { count: names.length }),
      onConfirm: () => {
        this.state.selectedUpdates.clear()
        this.executeBackground(['upgrade', '--yes', ...names], `upgrade ${names.length} tool(s)`)
      },
    }
    this.update()
  }

  async runSelectedTask() {
    const task = this.selectedTask()
    if (!task)
      return
    await this.executeCommand(['run', task.name], true)
  }

  async openConfig() {
    const config = this.selectedConfig()
    if (!config)
      return
    await this.executeCommand(['edit', config.path], true)
  }

  async runPageCommand() {
    const cmd = this.selectedPageCommand()
    if (!cmd)
      return
    this.#openCommandBuilder(cmd)
  }

  async toggleLanguage() {
    const cur = this.state.language
    this.state.language = cur === 'en' ? 'zh' : 'en'
    saveSettings({ language: this.state.language })
    this.state.status = `Language: ${this.state.language}`
    this.update()
  }

  setScope(scope) {
    if (this.state.scope === scope)
      return
    this.state.scope = scope
    this.state.status = t(this.state.language, scope === SCOPE.Project ? 'scope_project' : 'scope_global')
    this.update()
  }

  showHelp() {
    this.state.overlay = { type: 'Help' }
    this.update()
  }

  // ---- navigation helpers ----

  jumpToPage(page) {
    if (this.state.page === page)
      return
    this.state.page = page
    this.state.focus = FOCUS.Navigation
    this.state.selected = 0
    this.state.detailScroll = 0
    this.state.search = ''
    this.clampSelection()
    this.update()
  }

  changePage(delta) {
    const idx = PAGE_ORDER.indexOf(this.state.page)
    if (idx < 0)
      return
    const newIdx = ((idx + delta) % PAGE_ORDER.length + PAGE_ORDER.length) % PAGE_ORDER.length
    this.jumpToPage(PAGE_ORDER[newIdx])
  }

  cycleFocus(delta) {
    const seq = focusSeq()
    const idx = seq.indexOf(this.state.focus)
    if (idx < 0) {
      this.state.focus = FOCUS.Navigation
    }
    else {
      const newIdx = ((idx + delta) % seq.length + seq.length) % seq.length
      this.state.focus = seq[newIdx]
    }
    this.update()
  }

  moveVertical(delta) {
    const { focus } = this.state
    if (focus === FOCUS.Navigation) {
      // in nav, move between pages
      this.changePage(delta)
    }
    else if (focus === FOCUS.List) {
      const len = this.currentListLen()
      this.state.selected = moveIndex(this.state.selected, delta, len)
      this.clampSelection()
      this.update()
    }
    else if (focus === FOCUS.Details) {
      this.state.detailScroll = Math.max(0, this.state.detailScroll + delta)
      this.update()
    }
  }

  moveFocus(delta) {
    const seq = focusSeq()
    const idx = seq.indexOf(this.state.focus)
    if (idx < 0) {
      this.state.focus = FOCUS.Navigation
    }
    else {
      const newIdx = Math.max(0, Math.min(seq.length - 1, idx + delta))
      this.state.focus = seq[newIdx]
    }
    this.update()
  }

  #goTop() {
    if (this.state.focus === FOCUS.List) {
      this.state.selected = 0
      this.update()
    }
    else if (this.state.focus === FOCUS.Details) {
      this.state.detailScroll = 0
      this.update()
    }
  }

  #goBottom() {
    if (this.state.focus === FOCUS.List) {
      const len = this.currentListLen()
      this.state.selected = len > 0 ? len - 1 : 0
      this.update()
    }
    else if (this.state.focus === FOCUS.Details) {
      this.state.detailScroll = Number.MAX_SAFE_INTEGER
      this.update()
    }
  }

  #dismissConsoleTasks() {
    this.state.consoleTasks = this.state.consoleTasks.filter(t => t.status === 'pending' || t.status === 'running')
    this.clampSelection()
    this.update()
  }

  #copyToClipboard(text) {
    const platform = process.platform
    let cmd
    let args
    if (platform === 'darwin') { cmd = 'pbcopy'; args = [] }
    else if (platform === 'linux') { cmd = 'wl-copy'; args = [] }
    else { cmd = 'clip'; args = [] }

    const proc = spawnSync(cmd, args, { input: text, timeout: 3000 })
    if (proc.status !== 0) {
      throw new Error(proc.stderr?.toString() || 'clipboard unavailable')
    }
  }

  #copySelectedConfig() {
    const config = this.selectedConfig()
    if (!config) {
      this.state.status = t(this.state.language, 'no_config_selected')
      this.update()
      return
    }
    try {
      const text = readFileSync(config.path, 'utf8')
      this.#copyToClipboard(text)
      this.state.status = t(this.state.language, 'config_copied', { path: config.path })
    }
    catch {
      this.state.status = t(this.state.language, 'config_copy_failed', { error: err.message })
    }
    this.update()
  }

  // ---- selection helpers ----

  #filteredTools() {
    const tools = this.state.snapshot.tools || []
    if (!this.state.search)
      return tools
    const q = this.state.search.toLowerCase()
    return tools.filter(t => containsCaseInsensitive(t.name, q))
  }

  #filteredUpdates() {
    const updates = this.state.snapshot.updates || []
    if (!this.state.search)
      return updates
    const q = this.state.search.toLowerCase()
    return updates.filter(u => containsCaseInsensitive(u.name, q))
  }

  #filteredTasks() {
    const tasks = this.state.snapshot.tasks || []
    if (!this.state.search)
      return tasks
    const q = this.state.search.toLowerCase()
    return tasks.filter(t =>
      containsCaseInsensitive(t.name, q)
      || containsCaseInsensitive(t.description, q),
    )
  }

  #filteredConfigs() {
    const configs = this.state.snapshot.configs || []
    if (!this.state.search)
      return configs
    const q = this.state.search.toLowerCase()
    return configs.filter(c => containsCaseInsensitive(c.path, q))
  }

  #filteredLogs() {
    if (!this.state.search)
      return this.state.logs
    const q = this.state.search.toLowerCase()
    return this.state.logs.filter(l =>
      containsCaseInsensitive(l.command, q)
      || containsCaseInsensitive(l.output, q),
    )
  }

  #filteredPageCommands() {
    const { page, commands } = this.state
    const pageCmds = page === PAGE.Dashboard
      ? DASHBOARD_COMMANDS
      : commands.filter(c => commandBelongsToPage(page, c.name))
    if (!this.state.search)
      return pageCmds
    const q = this.state.search.toLowerCase()
    return pageCmds.filter(c => c.toLowerCase().includes(q))
  }

  selectedTool() {
    const filtered = this.#filteredTools()
    return filtered[this.state.selected] || null
  }

  selectedUpdate() {
    const filtered = this.#filteredUpdates()
    return filtered[this.state.selected] || null
  }

  selectedTask() {
    const filtered = this.#filteredTasks()
    return filtered[this.state.selected] || null
  }

  selectedConfig() {
    const filtered = this.#filteredConfigs()
    return filtered[this.state.selected] || null
  }

  selectedLog() {
    const filtered = this.#filteredLogs()
    return filtered[this.state.selected] || null
  }

  selectedPageCommand() {
    const filtered = this.#filteredPageCommands()
    const match = filtered[this.state.selected]
    if (!match)
      return null
    if (typeof match === 'string') {
      const full = this.state.commands.find(c => c.name === match)
      return full || { name: match, description: '' }
    }
    return match
  }

  matches(primary, secondary) {
    if (!this.state.search)
      return true
    const q = this.state.search.toLowerCase()
    return (primary || '').toLowerCase().includes(q)
      || (secondary || '').toLowerCase().includes(q)
  }

  currentListLen() {
    switch (this.state.page) {
      case PAGE.Tools: return this.#filteredTools().length
      case PAGE.Updates: return this.#filteredUpdates().length
      case PAGE.Tasks: return this.#filteredTasks().length
      case PAGE.Config: return this.#filteredConfigs().length
      case PAGE.Logs: return this.#filteredLogs().length
      case PAGE.Dashboard:
      case PAGE.Environment:
      case PAGE.System:
      case PAGE.Preferences:
        return this.#filteredPageCommands().length
      default: return 0
    }
  }

  clampSelection() {
    const len = this.currentListLen()
    if (len <= 0) {
      this.state.selected = 0
    }
    else {
      this.state.selected = Math.max(0, Math.min(this.state.selected, len - 1))
    }
  }

  // ---- internal helpers ----

  #closeOverlay() {
    this.state.overlay = null
  }
}
