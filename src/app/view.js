import { fg, StyledText, TextRenderable } from '@opentui/core'
import stringWidth from 'string-width'
import { t } from '../config/i18n.js'
import { clipColumns, containsCaseInsensitive, FOCUS, layoutMode, PAGE_ORDER } from './state.js'

const COLORS = {
  text: '#d4d4d4',
  muted: '#999999',
  warning: '#e5c07b',
  error: '#e06c75',
  present: '#87d787',
  border: '#767676',
  focus: '#00ffff',
  background: '#101010',
  selection: '#263238',
  selectedItem: '#263238',
  accent: '#00ffff',
}

const PANEL_IDS = ['nav', 'list', 'detail']
const PANEL_FOCUS = { nav: 'Navigation', list: 'List', detail: 'Details' }
const NODE_IDS = [
  'header',
  'headerInner',
  ...PANEL_IDS.flatMap(id => [`${id}Frame`, `${id}Inner`, `${id}Selection`]),
  'status',
  'statusInner',
  'keys',
  'modal',
  'modalInner',
  'modalSelection',
]

function padColumns(value, width) {
  const clipped = clipColumns(value, width)
  return `${clipped}${' '.repeat(Math.max(0, width - stringWidth(clipped)))}`
}

/** Keep the selected row visible and retain its position. */
function windowContent(lines, index, size) {
  const count = Math.max(0, size)
  const start = Math.min(Math.max(0, index - Math.floor(count / 2)), Math.max(0, lines.length - count))
  return {
    lines: lines.slice(start, start + count),
    start,
    selected: lines.length ? index - start : -1,
    counter: `${lines.length ? index + 1 : 0}/${lines.length}`,
  }
}

/** Sidebar: page navigation. */
function navContent(s) {
  const entries = PAGE_ORDER.map((page, _i) => {
    const marker = page === s.page ? '▸' : ' '
    return `${marker} ${pageName(page, s.language)}`
  })
  return {
    title: t(s.language, 'Sections', 'Sections'),
    ...windowContent(entries, PAGE_ORDER.indexOf(s.page), 20),
  }
}

function pageName(page, language) {
  return t(language, page)
}

/** Content list: varies by page. */
function listContent(s) {
  const { page, snapshot, search, selected, language } = s
  let items = []
  let title = ''
  let renderItem = null

  switch (page) {
    case 'Dashboard': {
      const stats = [
        t(language, 'Installed tools: {count}', { count: snapshot.tools.length }),
        t(language, 'Updates available: {count}', { count: snapshot.updates.filter(u => u.latest !== u.current).length }),
        t(language, 'Available tasks: {count}', { count: snapshot.tasks.length }),
        t(language, 'Config files: {count}', { count: snapshot.configs.length }),
        '',
        `mise ${snapshot.mise_version}`,
      ]
      return { title: t(language, 'Dashboard'), lines: stats, selected: -1, counter: '' }
    }
    case 'Tools': {
      items = snapshot.tools.filter(tool => matches(tool.name, tool.version, search))
      title = t(language, 'Tools')
      renderItem = tool => `${tool.installed ? '●' : '○'} ${clipColumns(tool.name, 20)}  ${clipColumns(tool.version, 12)}${!tool.active ? ` ${t(language, '(inactive)')}` : ''}`
      break
    }
    case 'Updates': {
      items = snapshot.updates.filter(u => matches(u.name, u.current, search))
      title = t(language, 'Updates')
      renderItem = u => `${s.selectedUpdates.has(u.name) ? '[x]' : '[ ]'} ${clipColumns(u.name, 20)}  ${clipColumns(u.current, 10)} → ${clipColumns(u.latest, 10)}`
      break
    }
    case 'Tasks': {
      items = snapshot.tasks.filter(t => matches(t.name, t.description, search))
      title = t(language, 'Tasks')
      renderItem = t => `▶ ${clipColumns(t.name, 30)}`
      break
    }
    case 'Environment':
    case 'System': {
      items = s.commands.filter(cmd => pageCommandsMatch(cmd, page, search))
      title = t(language, page)
      renderItem = cmd => `${clipColumns(cmd.name, 20)}  ${clipColumns(cmd.description, 30)}`
      break
    }
    case 'Config': {
      items = snapshot.configs.filter(c => matches(c.path, c.tools.join(' '), search))
      title = t(language, 'Config')
      renderItem = c => `${c.path.includes('mise') ? '●' : '○'} ${clipColumns(c.path, 50)}`
      break
    }
    case 'Preferences': {
      return {
        title: t(language, 'Language'),
        lines: [`  ${t(language, 'English')}`, `  ${t(language, '中文')}`],
        ...windowContent([t(language, 'English'), t(language, '中文')], language === 'zh' ? 1 : 0, 10),
      }
    }
    case 'Console': {
      const tasks = s.consoleTasks || []
      items = tasks
      title = t(language, 'Console')
      renderItem = (task) => {
        const icon = { pending: '⏳', running: '🔄', done: ' ✓', failed: ' ✗' }[task.status] || ' ?'
        const elapsed = task.startTime ? ` ${Math.round((Date.now() - task.startTime) / 1000)}s` : ''
        return `${icon} ${clipColumns(task.label, 40)}${clipColumns(elapsed, 8)}`
      }
      break
    }
    case 'Logs': {
      const logs = [...s.logs].reverse().filter(l => matches(l.command, l.output, search))
      items = logs
      title = t(language, 'Command Log')
      renderItem = l => `${l.success ? '✓' : '✗'} ${clipColumns(l.command, 50)}`
      break
    }
  }

  const entries = items.map(renderItem)
  const content = windowContent(entries, selected, 20)
  if (!entries.length) {
    content.lines.push(t(language, search ? 'No results' : getEmptyMessage(page, language)))
  }
  return { title, ...content }
}

function getEmptyMessage(page, _language) {
  const map = {
    Tools: 'No tools found',
    Updates: 'No updates found',
    Tasks: 'No tasks found',
    Environment: 'No commands found',
    Config: 'No configs found',
    System: 'No commands found',
    Logs: 'No logs found',
  }
  return map[page] || 'No items'
}

function matches(primary, secondary, query) {
  if (!query)
    return true
  return containsCaseInsensitive(primary, query) || containsCaseInsensitive(secondary, query)
}

function pageCommandsMatch(cmd, page, query) {
  return matches(cmd.name, cmd.description, query)
}

/** Detail panel: shows info about selected item. */
function detailContent(s) {
  const { page, snapshot, selected, search, language, logs, scope, commands } = s

  let lines = []
  const title = t(language, 'Details')

  switch (page) {
    case 'Dashboard': {
      lines = [
        `mise ${snapshot.mise_version}`,
        '',
        t(language, 'Installed tools: {count}', { count: snapshot.tools.length }),
        t(language, 'Updates available: {count}', { count: snapshot.updates.length }),
        t(language, 'Tasks: {count}', { count: snapshot.tasks.length }),
        t(language, 'Configs: {count}', { count: snapshot.configs.length }),
        '',
        `${t(language, 'Scope')}: ${scope === 'Global' ? 'GLOBAL' : 'PROJECT'}`,
      ]
      break
    }
    case 'Tools': {
      const filteredTools = snapshot.tools.filter(t => matches(t.name, t.version, search))
      const tool = filteredTools[selected]
      if (tool) {
        lines = [
          `${t(language, 'Tool')}: ${tool.name}`,
          `${t(language, 'Version')}: ${tool.version}`,
          `${t(language, 'Requested')}: ${tool.requested || '—'}`,
          tool.source ? `${t(language, 'Source')}: ${tool.source}` : '',
          `${t(language, 'Installed')}: ${tool.installed ? t(language, 'Yes') : t(language, 'No')}`,
          `${t(language, 'Active')}: ${tool.active ? t(language, 'Yes') : t(language, 'No')}`,
          '',
          t(language, 'v: use version  i: install version  d: uninstall'),
        ].filter(Boolean)
      }
      else {
        lines = [t(language, 'No tool selected')]
      }
      break
    }
    case 'Updates': {
      const filteredUpdates = snapshot.updates.filter(u => matches(u.name, u.current, search))
      const update = filteredUpdates[selected]
      if (update) {
        lines = [
          `${t(language, 'Tool')}: ${update.name}`,
          `${t(language, 'Current')}: ${update.current}`,
          `${t(language, 'Latest')}: ${update.latest}`,
          '',
          t(language, 'Space: toggle  U: upgrade all selected'),
        ]
      }
      else {
        lines = [t(language, 'No update selected')]
      }
      break
    }
    case 'Tasks': {
      const filteredTasks = snapshot.tasks.filter(t => matches(t.name, t.description, search))
      const task = filteredTasks[selected]
      if (task) {
        lines = [
          `${t(language, 'Task')}: ${task.name}`,
          `${t(language, 'Description')}: ${task.description || '—'}`,
          `${t(language, 'Command')}: ${task.command || '—'}`,
          '',
          t(language, 'Enter: run task'),
        ]
      }
      else {
        lines = [t(language, 'No task selected')]
      }
      break
    }
    case 'Environment':
    case 'System': {
      const filteredCommands = commands.filter(cmd => pageCommandsMatch(cmd, page, search))
      const cmd = filteredCommands[selected]
      if (cmd) {
        lines = [
          `${t(language, 'Command')}: mise ${cmd.name}`,
          `${t(language, 'Description')}: ${cmd.description}`,
          '',
          t(language, 'Enter: open command builder'),
        ]
      }
      else {
        lines = [t(language, 'No command selected')]
      }
      break
    }
    case 'Config': {
      const filteredConfigs = snapshot.configs.filter(c => matches(c.path, c.tools.join(' '), search))
      const config = filteredConfigs[selected]
      if (config) {
        lines = [
          `${t(language, 'Path')}: ${config.path}`,
          '',
          t(language, 'Tools in config:'),
          ...config.tools.map(t => `  • ${t}`),
          '',
          t(language, 'e_y_copy'),
        ]
      }
      else {
        lines = [t(language, 'No config selected')]
      }
      break
    }
    case 'Preferences': {
      lines = [
        t(language, 'Current language: {language}', { language: language === 'zh' ? '中文' : 'English' }),
        '',
        t(language, 'Enter: toggle language'),
        t(language, 'Changes persist automatically'),
      ]
      break
    }
    case 'Console': {
      const tasks = s.consoleTasks || []
      const task = tasks[selected]
      if (task) {
        const statusText = {
          pending: t(language, 'console_pending'),
          running: t(language, 'console_running'),
          done: t(language, 'console_done'),
          failed: t(language, 'console_failed'),
        }[task.status] || task.status
        const elapsed = task.startTime ? Math.round(((task.endTime || Date.now()) - task.startTime) / 1000) : 0
        lines = [
          `${task.label}`,
          `${t(language, 'Status')}: ${statusText}`,
          `${t(language, 'Command')}: ${task.command}`,
          `${t(language, 'Duration')}: ${elapsed}s`,
          '',
          task.output || t(language, '(waiting for output...)'),
        ]
      }
      else {
        lines = [t(language, 'No task selected')]
      }
      break
    }
    case 'Logs': {
      const filteredLogs = [...logs].reverse().filter(l => matches(l.command, l.output, search))
      const log = filteredLogs[selected]
      if (log) {
        lines = [
          `${t(language, 'Command')}: ${log.command}`,
          `${t(language, 'Status')}: ${log.success ? t(language, 'Success') : t(language, 'Failed')}`,
          '',
          log.output,
        ]
      }
      else {
        lines = [t(language, 'No log selected')]
      }
      break
    }
  }

  return { title, lines }
}

function pageActionsHint(s) {
  const lang = s.language
  switch (s.page) {
    case 'Dashboard': return t(lang, 'r refresh  a add tool')
    case 'Tools': return t(lang, 'a add  v use  i install  d delete  r refresh  p/G scope')
    case 'Updates': return t(lang, 'Space select  U upgrade  r refresh')
    case 'Tasks': return t(lang, 'Enter run  r refresh')
    case 'Environment': return t(lang, 'Enter open  r refresh')
    case 'Config': return t(lang, 'e edit  y copy  r refresh')
    case 'Console': return t(lang, 'j/k select  d dismiss done')
    case 'System': return t(lang, 'Enter open  r refresh')
    case 'Preferences': return t(lang, 'Enter toggle')
    case 'Logs': return t(lang, 'j/k scroll  / search')
    default: return ''
  }
}

function box(id, left, top, width, height, content, frameColor = COLORS.border, color = COLORS.text) {
  if (width < 4 || height < 2)
    return false
  const innerWidth = width - 2
  const innerHeight = height - 2
  const label = clipColumns(` ${content.title || ''} `, innerWidth)
  const counter = content.counter ? clipColumns(` ${content.counter} `, innerWidth) : ''

  const border = {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
  }

  const frame = [
    `${border.topLeft}${label}${border.horizontal.repeat(innerWidth - stringWidth(label))}${border.topRight}`,
    ...Array.from({ length: innerHeight }, () => `${border.vertical}${' '.repeat(innerWidth)}${border.vertical}`),
    `${border.bottomLeft}${border.horizontal.repeat(innerWidth - stringWidth(counter))}${counter}${border.bottomRight}`,
  ]

  return {
    frame: { left, top, width, height, lines: frame, color: frameColor },
    inner: {
      left: left + 1,
      top: top + 1,
      width: innerWidth,
      height: innerHeight,
      lines: content.lines.map(line => ` ${line}`),
      color,
      colors: content.colors,
      selected: content.selected,
      selectedLine: content.lines[content.selected] || '',
    },
  }
}

/** Render a bordered panel with focus-aware frame color. */
function panel(id, left, top, width, height, content, s) {
  const focused = PANEL_FOCUS[id] === s.focus
  return box(id, left, top, width, height, { ...content, title: content.title }, focused ? COLORS.focus : COLORS.border)
}

/** Show a single TextRenderable node. */
function showNode(nodes, id, left, top, width, height, lines, color = COLORS.text, background = COLORS.background, colors) {
  const node = nodes[id]
  if (!node || width <= 0 || height <= 0) {
    if (node)
      node.visible = false
    return
  }
  node.visible = true
  Object.assign(node, { left, top, width, height, fg: color, bg: background })
  const visible = lines.slice(0, height).map(line => clipColumns(line, width))
  if (colors) {
    node.content = new StyledText(visible.map((line, index) => fg(colors[index] || color)(`${index ? '\n' : ''}${line}`)))
  }
  else {
    node.content = visible.join('\n')
  }
}

/** Render a box result onto nodes. */
function renderBox(nodes, id, boxResult) {
  if (!boxResult)
    return
  showNode(nodes, `${id}Frame`, boxResult.frame.left, boxResult.frame.top, boxResult.frame.width, boxResult.frame.height, boxResult.frame.lines, boxResult.frame.color)
  showNode(nodes, `${id}Inner`, boxResult.inner.left, boxResult.inner.top, boxResult.inner.width, boxResult.inner.height, boxResult.inner.lines, boxResult.inner.color, COLORS.background, boxResult.inner.colors)
  if (boxResult.inner.selected >= 0 && boxResult.inner.selected < boxResult.inner.height) {
    showNode(nodes, `${id}Selection`, boxResult.inner.left, boxResult.inner.top + boxResult.inner.selected, boxResult.inner.width, 1, [padColumns(boxResult.inner.lines[boxResult.inner.selected] || '', boxResult.inner.width)], COLORS.accent, COLORS.selection)
  }
}

/** Create the view function that renders application state. */
export function createView(renderer) {
  const nodes = {}
  for (const id of NODE_IDS) {
    nodes[id] = new TextRenderable(renderer, {
      id,
      position: 'absolute',
      left: 0,
      top: 0,
      width: 1,
      height: 1,
      content: '',
      fg: COLORS.text,
      bg: COLORS.background,
      wrapMode: 'none',
      selectable: false,
    })
    renderer.root.add(nodes[id])
  }

  return (s, app) => {
    s.width = renderer.width
    s.height = renderer.height
    const { width, height, language } = s
    const mode = layoutMode(width, height)

    // Hide all nodes first
    for (const node of Object.values(nodes))
      node.visible = false

    if (mode === 'small') {
      showNode(nodes, 'header', 0, 0, width, 1, [t(language, 'Terminal too small')], COLORS.warning)
      showNode(nodes, 'keys', 0, height - 1, width, 1, [t(language, 'Resize, or q/Ctrl-c to quit')], COLORS.muted)
      renderer.requestRender()
      return
    }

    // Header bar
    const headerLine = `  LAZYMISE   ${clipColumns(`[${s.scope === 'Global' ? 'GLOBAL' : 'PROJECT'}]`, 12)}   mise ${s.snapshot.mise_version}`
    showNode(nodes, 'header', 0, 0, width, 1, [padColumns(headerLine, width)], COLORS.text, COLORS.selection)

    if (mode === 'dual') {
      const navWidth = Math.floor(width * 0.2)
      const listWidth = Math.floor(width * 0.32)
      const detailLeft = navWidth + listWidth + 2
      const detailWidth = width - detailLeft
      const panelHeight = height - 3
      const detailHeight = panelHeight

      const navResult = panel('nav', 1, 1, navWidth, panelHeight, navContent(s), s)
      renderBox(nodes, 'nav', navResult)

      const listResult = panel('list', navWidth + 1, 1, listWidth, panelHeight, listContent(s), s)
      renderBox(nodes, 'list', listResult)

      const detailResult = panel('detail', detailLeft, 1, detailWidth, detailHeight, detailContent(s), s)
      renderBox(nodes, 'detail', detailResult)
    }
    else {
      // Single mode: stacked layout
      const topHeight = Math.floor((height - 3) * 0.55)
      const bottomHeight = height - 3 - topHeight

      const focusedPane = s.focus
      const topId = focusedPane === FOCUS.Navigation ? 'nav' : 'list'
      const bottomId = focusedPane === FOCUS.Details ? 'detail' : (topId === 'nav' ? 'list' : 'nav')
      const allContent = {
        nav: navContent(s),
        list: listContent(s),
        detail: detailContent(s),
      }

      const topResult = panel(topId, 1, 1, width - 2, topHeight, allContent[topId], s)
      renderBox(nodes, topId, topResult)

      const bottomResult = panel(bottomId, 1, 1 + topHeight, width - 2, bottomHeight, allContent[bottomId], s)
      renderBox(nodes, bottomId, bottomResult)
    }

    // Status bar
    showNode(nodes, 'status', 0, height - 2, width, 1, [clipColumns(renderStatus(s, app), width)], s.loading ? COLORS.warning : COLORS.muted)

    // Key hints
    const hintsStr = `${s.page}: ${pageActionsHint(s)}`
    showNode(nodes, 'keys', 0, height - 1, width, 1, [clipColumns(hintsStr, width)], COLORS.muted)

    // Overlay rendering
    if (s.overlay) {
      renderOverlay(nodes, s.overlay, width, height, s.language, s.search)
    }

    renderer.requestRender()
  }
}

function renderStatus(s) {
  if (s.loading)
    return t(s.language, 'Loading...')
  const active = (s.consoleTasks || []).filter(t => t.status === 'pending' || t.status === 'running')
  const prefix = active.length ? `[${active.length} running] ` : ''
  if (s.status)
    return prefix + s.status
  return prefix + t(s.language, 'Ready')
}

function renderOverlay(nodes, overlay, width, height, language, searchText) {
  const modalWidth = Math.min(width - 8, 80)
  const modalHeight = Math.min(height - 6, 20)
  const left = Math.floor((width - modalWidth) / 2)
  const top = Math.max(2, Math.floor((height - modalHeight) / 2))

  let title = ''
  let lines = []
  let selected = -1

  switch (overlay.type) {
    case 'Help': {
      title = 'LAZYMISE — mise TUI'
      lines = [
        '',
        '1-8/g/u/t/E/c/s/o/x: page jump',
        'j/k/↑/↓: move  h/l/←/→: switch focus',
        'Tab: cycle focus  Esc: back to navigation',
        '',
        'a: add tool  A: custom tool  v: use version',
        'i: install  d: delete  Space: select update',
        'U: upgrade  Enter: run/open  e: edit config',
        'r: refresh  p/G: scope  /: search',
        ':: command palette  m: page commands',
        '?: help  q/Ctrl-c: quit',
      ]
      break
    }
    case 'Search': {
      title = 'Search'
      lines = [`Search: ${searchText || ''}█`]
      break
    }
    case 'Picker': {
      title = renderPickerTitle(overlay, language)
      lines = renderPickerLines(overlay, language)
      selected = overlay.selected || 0
      break
    }
    case 'CommandPalette': {
      const query = overlay.search || ''
      title = query ? `Command Palette ─ ${query}` : 'Command Palette'
      const filterItems = overlay.commands || overlay.items || []
      const visible = filterItems.filter(i => matches(i.name, i.description, query))
      const content = windowContent(
        visible.map(i => `${clipColumns(i.name, 25)}  ${clipColumns(i.description, 40)}`),
        overlay.selected || 0,
        modalHeight - 3,
      )
      lines = content.lines
      selected = content.selected
      if (!visible.length)
        lines = ['No matching commands']
      break
    }
    case 'CommandBuilder': {
      const cmdName = overlay.command || ''
      title = `mise ${cmdName}`
      const argsLine = `Arguments: ${overlay.args || ''}█`
      const helpLines = (overlay.help || '').split('\n')
      const helpContent = windowContent(helpLines, overlay.scroll || 0, modalHeight - 4)
      lines = [argsLine, '', ...helpContent.lines]
      selected = overlay.mode === 'help' ? helpContent.selected + 1 : 0
      break
    }
    case 'CustomTool': {
      title = 'Custom tool'
      const scope = overlay.scope || 'Project'
      lines = [
        'Input backend identifier:',
        `${overlay.input || ''}█`,
        '',
        `[${scope === 'Global' ? 'GLOBAL' : 'PROJECT'}]  Tab: toggle scope`,
      ]
      break
    }
    case 'ConfirmDelete': {
      title = 'Confirm delete'
      lines = [
        overlay.message || `Delete ${overlay.name || ''}?`,
        '',
        'Enter/y: confirm  Esc/n: cancel',
      ]
      break
    }
    case 'ConfirmCommand': {
      title = 'Confirm'
      lines = [
        overlay.message || `mise ${(overlay.args || []).join(' ')}`,
        '',
        'Enter/y: confirm  Esc/n: cancel',
      ]
      break
    }
  }

  const boxResult = box('modal', left, top, modalWidth, Math.min(modalHeight, lines.length + 2), { title, lines, selected }, COLORS.focus)
  renderBox(nodes, 'modal', boxResult)
}

function renderPickerTitle(overlay, _language) {
  switch (overlay.level) {
    case 'registry': return 'Registry'
    case 'backends': return 'Select backend'
    case 'versions': return 'Select version'
    default: return ''
  }
}

function renderPickerLines(overlay, _language) {
  switch (overlay.level) {
    case 'registry': {
      const items = overlay.tools || []
      const backends = overlay.backends || ['All']
      const filterIdx = overlay.filterIdx || 0
      const filterLabel = backends[filterIdx] || 'All'
      const query = overlay.search || ''
      const filtered = items.filter(i => matches(i.name, i.description, query))
      const header = [
        `[${filterLabel}] Search: ${query}${overlay.searching ? '█' : ''}`,
        '',
      ]
      const content = windowContent(
        filtered.map(i => `${clipColumns(i.name, 25)}  ${clipColumns(i.description, 35)}`),
        overlay.selected || 0,
        15,
      )
      return [...header, ...content.lines]
    }
    case 'backends': {
      const backends = overlay.backendList || []
      const content = windowContent(backends, overlay.backendSelected || 0, 15)
      return content.lines
    }
    case 'versions': {
      const versions = overlay.versions || []
      const content = windowContent(
        versions.map(v => `${clipColumns(v.version, 16)}  ${clipColumns(v.created_at || '', 20)}`),
        overlay.selected || 0,
        15,
      )
      return content.lines
    }
    default:
      return []
  }
}
