import { relative } from 'node:path'
import { fg, StyledText, TextRenderable } from '@opentui/core'
import stringWidth from 'string-width'
import { t } from '../config/i18n.js'
import { DEFAULT_THEME, themeColors, themeName } from '../config/themes.js'
import { clipColumns, filterCommands, filterRegistryTools, FOCUS, layoutMode, PAGE_ORDER, preferenceItems, supportsConfigTarget } from './state.js'

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })

// One view per process; each render swaps in the palette before drawing.
let COLORS = themeColors(DEFAULT_THEME)

const PANEL_IDS = ['nav', 'list', 'detail']
const PANEL_FOCUS = { nav: 'Navigation', list: 'List', detail: 'Details' }
const NODE_IDS = [
  'header',
  'headerInner',
  ...PANEL_IDS.flatMap(id => [`${id}Frame`, `${id}Inner`, `${id}Selection`]),
  'status',
  'statusInner',
  'keys',
  'modalFrame',
  'modalInner',
  'modalSelection',
]

function padColumns(value, width) {
  const clipped = clipColumns(value, width)
  return `${clipped}${' '.repeat(Math.max(0, width - stringWidth(clipped)))}`
}

/** Wrap text to fit within a given width, preserving newlines. */
function wrap(value, width) {
  if (width <= 0)
    return []
  const result = []
  for (const line of value.split('\n')) {
    let current = ''
    let columns = 0
    for (const { segment } of segmenter.segment(line)) {
      const size = stringWidth(segment)
      if (columns + size > width && current) {
        result.push(current)
        current = ''
        columns = 0
      }
      current += size > width ? '…' : segment
      columns += size > width ? 1 : size
    }
    result.push(current)
  }
  return result
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
function navContent(s, capacity) {
  const shortcuts = { Dashboard: '1', Tools: '2', Updates: '3', Tasks: '4', Environment: '5', Config: '6', System: '7', Preferences: '8', Console: '9', Logs: '0' }
  const entries = PAGE_ORDER.map(page => `${page === s.page ? '▸' : ' '} ${shortcuts[page]} ${pageName(page, s.language)}`)
  return {
    title: t(s.language, 'Sections'),
    ...windowContent(entries, PAGE_ORDER.indexOf(s.page), capacity),
  }
}

function pageName(page, language) {
  return t(language, page)
}

/** Content list: varies by page. */
function listContent(s, items, capacity, width) {
  const { page, snapshot, search, selected, language } = s
  let title = ''
  let renderItem = null

  switch (page) {
    case 'Dashboard': {
      const stats = [
        t(language, 'dashboard_tools_count', { count: snapshot.tools.length }),
        t(language, 'dashboard_updates_count', { count: snapshot.updates.filter(u => u.latest !== u.current).length }),
        t(language, 'dashboard_tasks_count', { count: snapshot.tasks.length }),
        t(language, 'dashboard_configs_count', { count: snapshot.configs.length }),
        '',
        t(language, 'dashboard_version', { version: snapshot.mise_version }),
      ]
      return { title: t(language, 'dashboard_title'), lines: stats, selected: -1, counter: '' }
    }
    case 'Tools': {
      title = t(language, 'Tools')
      renderItem = (tool) => {
        const suffix = `${clipColumns(tool.version, 12)}${!tool.active ? ` ${t(language, '(inactive)')}` : ''}`
        const nameWidth = Math.max(1, width - stringWidth(suffix) - 4)
        return `${tool.installed ? '●' : '○'} ${padColumns(tool.name, nameWidth)}  ${suffix}`
      }
      break
    }
    case 'Updates': {
      title = t(language, 'Updates')
      renderItem = u => `${s.selectedUpdates.has(u.name) ? '[x]' : '[ ]'} ${clipColumns(u.name, 20)}  ${clipColumns(u.current, 10)} → ${clipColumns(u.latest, 10)}`
      break
    }
    case 'Tasks': {
      title = t(language, 'Tasks')
      renderItem = t => `▶ ${clipColumns(t.name, 30)}`
      break
    }
    case 'Environment':
    case 'System': {
      title = t(language, page)
      renderItem = cmd => `${clipColumns(cmd.name, 20)}  ${clipColumns(cmd.description, 30)}`
      break
    }
    case 'Config': {
      title = t(language, 'Config')
      renderItem = c => `${s.configTarget?.path === c.path ? '●' : '○'} ${clipPath(displayPath(c.path), width - 2)}${supportsConfigTarget(c.path) ? '' : ` [${t(language, 'config_target_unsupported')}]`}`
      break
    }
    case 'Preferences': {
      return {
        title: t(language, 'preferences_title'),
        ...windowContent(items.map(item => `${(item.kind === 'theme' ? item.id === s.theme : item.id === language) ? '●' : '○'} ${item.name}`), selected, capacity),
      }
    }
    case 'Console': {
      title = t(language, 'Console')
      renderItem = (task) => {
        const icon = { pending: '·', running: '↻', done: '✓', failed: '✗' }[task.status] || '?'
        const elapsed = task.startTime ? ` ${Math.round(((task.endTime || Date.now()) - task.startTime) / 1000)}s` : ''
        return `${icon} ${clipColumns(task.label, 40)}${clipColumns(elapsed, 8)}`
      }
      break
    }
    case 'Logs': {
      title = t(language, 'Command Log')
      renderItem = l => `${l.success ? '✓' : '✗'} ${clipColumns(l.command, 50)}`
      break
    }
  }

  const entries = items.map(renderItem)
  const content = windowContent(entries, selected, capacity)
  if (!entries.length) {
    content.lines.push(search ? t(language, 'no_results') : getEmptyMessage(page, language))
  }
  return { title, ...content }
}

function getEmptyMessage(page, language) {
  const map = {
    Tools: 'no_tools',
    Updates: 'no_updates',
    Tasks: 'no_tasks',
    Environment: 'no_commands',
    Config: 'no_configs',
    System: 'no_commands',
    Logs: 'no_logs',
  }
  return t(language, map[page] || 'no_items')
}

/** Detail panel: shows info about selected item. */
function detailContent(s, items) {
  const { page, snapshot, selected, language } = s

  let lines = []
  const title = t(language, 'Details')

  switch (page) {
    case 'Dashboard': {
      lines = [
        t(language, 'dashboard_version', { version: snapshot.mise_version }),
        '',
        t(language, 'dashboard_tools_count', { count: snapshot.tools.length }),
        t(language, 'dashboard_updates_count', { count: snapshot.updates.length }),
        t(language, 'dashboard_tasks_count', { count: snapshot.tasks.length }),
        t(language, 'dashboard_configs_count', { count: snapshot.configs.length }),
        '',
        targetHint(s),
      ]
      break
    }
    case 'Tools': {
      const tool = items[selected]
      if (tool) {
        lines = [
          `${t(language, 'detail_tool')}: ${tool.name}`,
          `${t(language, 'detail_version')}: ${tool.version}`,
          `${t(language, 'detail_requested')}: ${tool.requested || '—'}`,
          tool.source ? `${t(language, 'detail_source')}: ${tool.source}` : '',
          `${t(language, 'detail_installed')}: ${tool.installed ? t(language, 'installed') : t(language, 'not_installed')}`,
          `${t(language, 'detail_active')}: ${tool.active ? t(language, 'active') : t(language, 'inactive')}`,
          '',
          t(language, 'detail_tools_hint'),
        ].filter(Boolean)
      }
      else {
        lines = [t(language, 'No tool selected')]
      }
      break
    }
    case 'Updates': {
      const update = items[selected]
      if (update) {
        lines = [
          `${t(language, 'detail_tool')}: ${update.name}`,
          `${t(language, 'current')}: ${update.current}`,
          `${t(language, 'latest')}: ${update.latest}`,
          '',
          t(language, 'detail_updates_hint'),
        ]
      }
      else {
        lines = [t(language, 'No update selected')]
      }
      break
    }
    case 'Tasks': {
      const task = items[selected]
      if (task) {
        lines = [
          `${t(language, 'detail_task')}: ${task.name}`,
          `${t(language, 'description')}: ${task.description || '—'}`,
          `${t(language, 'detail_command')}: ${task.command || '—'}`,
          '',
          t(language, 'detail_tasks_hint'),
        ]
      }
      else {
        lines = [t(language, 'No task selected')]
      }
      break
    }
    case 'Environment':
    case 'System': {
      const cmd = items[selected]
      if (cmd) {
        lines = [
          `${t(language, 'detail_command')}: mise ${cmd.name}`,
          `${t(language, 'description')}: ${cmd.description}`,
          '',
          t(language, 'detail_environment_hint'),
        ]
      }
      else {
        lines = [t(language, 'No command selected')]
      }
      break
    }
    case 'Config': {
      const config = items[selected]
      if (config) {
        lines = [
          `${t(language, 'Path')}: ${config.path}`,
          s.configTarget?.path === config.path ? t(language, 'config_target_selected', { path: config.path }) : '',
          supportsConfigTarget(config.path) ? '' : t(language, 'config_target_unsupported'),
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
        t(language, 'current_language', { lang: preferenceItems().find(item => item.id === language)?.name || language }),
        t(language, 'current_theme', { theme: themeName(s.theme) }),
        '',
        t(language, 'apply_selected_setting'),
        t(language, 'changes_persist'),
      ]
      break
    }
    case 'Console': {
      const task = items[selected]
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
      const log = items[selected]
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
  if (s.overlay)
    return overlayHint(s.overlay, lang)
  if (s.focus === FOCUS.Navigation)
    return t(lang, 'navigation_hint')
  if (s.focus === FOCUS.Details)
    return t(lang, 'details_hint')
  switch (s.page) {
    case 'Dashboard': return t(lang, 'dashboard_hint')
    case 'Tools': return t(lang, 'tools_hint')
    case 'Updates': return t(lang, 'updates_hint')
    case 'Tasks': return t(lang, 'tasks_hint')
    case 'Environment': return t(lang, 'environment_hint')
    case 'Config': return t(lang, 'config_hint')
    case 'Console': return t(lang, 'console_hint')
    case 'System': return t(lang, 'system_hint')
    case 'Preferences': return t(lang, 'preferences_hint')
    case 'Logs': return t(lang, 'logs_hint')
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
    showNode(nodes, `${id}Selection`, boxResult.inner.left, boxResult.inner.top + boxResult.inner.selected, boxResult.inner.width, 1, [padColumns(boxResult.inner.lines[boxResult.inner.selected] || '', boxResult.inner.width)], COLORS.selectionText, COLORS.selection)
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
    const { width, height } = renderer
    const { language } = s
    COLORS = themeColors(s.theme)
    const items = app.visibleItems()
    let detailMaxScroll = 0
    const mode = layoutMode(width, height)

    // Hide all nodes first
    for (const node of Object.values(nodes))
      node.visible = false

    if (mode === 'small') {
      showNode(nodes, 'header', 0, 0, width, 1, [t(language, 'Terminal too small')], COLORS.warning)
      showNode(nodes, 'keys', 0, height - 1, width, 1, [t(language, 'Resize, or q/Ctrl-c to quit')], COLORS.muted)
      renderer.requestRender()
      return { width, height, detailMaxScroll }
    }

    // Header bar
    const prefix = ` LAZYMISE  ${t(language, 'config_target_header')} `
    const suffix = `  ${t(language, 'config_target_select_hint')} `
    const target = s.configTarget ? displayPath(s.configTarget.path) : t(language, 'config_target_none')
    const headerLine = `${prefix}${clipPath(target, width - stringWidth(prefix + suffix))}${suffix}`
    showNode(nodes, 'header', 0, 0, width, 1, [padColumns(headerLine, width)], COLORS.text, COLORS.selection)

    if (mode === 'dual') {
      const navWidth = Math.floor((width - 2) / 5)
      const listWidth = Math.floor((width - navWidth - 2) / 2)
      const detailLeft = navWidth + listWidth + 2
      const detailWidth = width - detailLeft
      const panelHeight = height - 3
      const detailHeight = panelHeight

      const navResult = panel('nav', 1, 1, navWidth, panelHeight, navContent(s, panelHeight - 2), s)
      renderBox(nodes, 'nav', navResult)

      const listResult = panel('list', navWidth + 1, 1, listWidth, panelHeight, listContent(s, items, panelHeight - 2, listWidth - 3), s)
      renderBox(nodes, 'list', listResult)

      const detail = detailViewport(s, items, detailWidth - 3, detailHeight - 2)
      detailMaxScroll = detail.maxScroll
      const detailResult = panel('detail', detailLeft, 1, detailWidth, detailHeight, detail, s)
      renderBox(nodes, 'detail', detailResult)
    }
    else {
      // Single mode: stacked layout
      const topHeight = Math.floor((height - 3) * 0.55)
      const bottomHeight = height - 3 - topHeight

      const focusedPane = s.focus
      const topId = focusedPane === FOCUS.Navigation ? 'nav' : 'list'
      const bottomId = focusedPane === FOCUS.Details ? 'detail' : (topId === 'nav' ? 'list' : 'nav')
      const detail = detailViewport(s, items, width - 5, bottomHeight - 2)
      detailMaxScroll = detail.maxScroll
      const contentFor = (id, capacity) => id === 'nav'
        ? navContent(s, capacity)
        : id === 'list' ? listContent(s, items, capacity, width - 5) : detail

      const topResult = panel(topId, 1, 1, width - 2, topHeight, contentFor(topId, topHeight - 2), s)
      renderBox(nodes, topId, topResult)

      const bottomResult = panel(bottomId, 1, 1 + topHeight, width - 2, bottomHeight, contentFor(bottomId, bottomHeight - 2), s)
      renderBox(nodes, bottomId, bottomResult)
    }

    // Status bar
    showNode(nodes, 'status', 0, height - 2, width, 1, [clipColumns(renderStatus(s, app), width)], s.loading ? COLORS.warning : COLORS.muted)

    // Key hints
    const hintsStr = `${t(language, s.page)}: ${pageActionsHint(s)}`
    showNode(nodes, 'keys', 0, height - 1, width, 1, [clipColumns(hintsStr, width)], COLORS.muted)

    // Overlay rendering
    const overlayMaxScroll = s.overlay ? renderOverlay(nodes, s, app, width, height) : null

    renderer.requestRender()
    return { width, height, detailMaxScroll, overlayMaxScroll }
  }
}

function renderStatus(s) {
  if (s.loading)
    return t(s.language, 'loading')
  const active = (s.consoleTasks || []).filter(t => t.status === 'pending' || t.status === 'running')
  const prefix = active.length ? `${t(s.language, 'status_running_count', { count: active.length })} ` : ''
  if (s.status)
    return prefix + s.status
  return prefix + t(s.language, 'status_ready')
}

function inputLine(label, value, width) {
  const prefix = clipColumns(label, Math.floor(width / 2))
  const budget = Math.max(0, width - stringWidth(prefix) - 1)
  const graphemes = [...segmenter.segment(value)]
  let tail = ''
  let columns = 0
  for (let index = graphemes.length - 1; index >= 0; index--) {
    const segment = graphemes[index].segment
    const size = stringWidth(segment)
    if (columns + size > budget)
      break
    tail = segment + tail
    columns += size
  }
  return `${prefix}${tail}█`
}

function itemLine(name, description, width) {
  const nameWidth = Math.min(25, Math.floor((width - 2) / 2))
  return `${padColumns(name, nameWidth)}  ${clipColumns(description, width - nameWidth - 2)}`
}

function displayPath(path) {
  const local = relative(process.cwd(), path)
  return local && local !== '..' && !local.startsWith('../') ? `./${local}` : path
}

function clipPath(path, width) {
  if (stringWidth(path) <= width)
    return path
  if (width <= 1)
    return width === 1 ? '…' : ''
  const segments = [...segmenter.segment(path)]
  let tail = ''
  let columns = 1
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index].segment
    const size = stringWidth(segment)
    if (columns + size > width)
      break
    tail = segment + tail
    columns += size
  }
  return `…${tail}`
}

function targetHint(s) {
  return t(s.language, 'config_target_selected', {
    path: s.configTarget?.path || t(s.language, 'config_target_none'),
  })
}

function detailViewport(s, items, width, height) {
  const content = detailContent(s, items)
  const lines = content.lines.flatMap(line => wrap(line, width))
  const capacity = Math.max(0, height)
  const maxScroll = items.length || s.page === 'Dashboard' ? Math.max(0, lines.length - capacity) : 0
  const scroll = Math.max(0, Math.min(s.detailScroll, maxScroll))
  return {
    title: content.title,
    lines: lines.slice(scroll, scroll + capacity),
    counter: `${lines.length ? scroll + 1 : 0}–${Math.min(lines.length, scroll + capacity)}/${lines.length}`,
    maxScroll,
  }
}

function overlayHint(overlay, language) {
  if (overlay.type === 'ConfirmCommand' || overlay.type === 'ConfirmDelete')
    return t(language, 'confirm_prompt')
  if (overlay.type === 'Search' || overlay.searching)
    return t(language, 'text_search_hint')
  if (overlay.type === 'ConfigTarget')
    return t(language, overlay.mode === 'path' ? 'config_target_path_hint' : 'config_target_list_hint')
  if (overlay.type === 'CustomTool')
    return t(language, 'custom_tool_hint')
  if (overlay.type === 'CommandBuilder')
    return t(language, overlay.mode === 'help' ? 'builder_help_hint' : 'builder_input_hint')
  if (overlay.type === 'CommandPalette')
    return t(language, 'palette_hint')
  if (overlay.type === 'Help')
    return t(language, 'help_scroll_hint')
  if (overlay.loading)
    return t(language, 'loading_hint')
  if (overlay.type === 'Picker') {
    if (overlay.level === 'registry')
      return t(language, 'registry_hint')
    return t(language, overlay.intent === 'Install' ? 'install_hint' : 'picker_hint')
  }
  return ''
}

function scrollContent(lines, scroll, capacity) {
  const start = Math.max(0, Math.min(scroll || 0, Math.max(0, lines.length - capacity)))
  return {
    lines: lines.slice(start, start + capacity),
    counter: `${lines.length ? start + 1 : 0}–${Math.min(lines.length, start + capacity)}/${lines.length}`,
    maxScroll: Math.max(0, lines.length - capacity),
  }
}

function renderOverlay(nodes, s, app, width, height) {
  const { overlay, language } = s
  const modalWidth = Math.min(width - 8, 80)
  const modalHeight = height - 4
  const contentWidth = modalWidth - 4
  const capacity = Math.max(0, modalHeight - 3)
  let title = ''
  let lines = []
  let selected = -1
  let counter = ''
  let maxScroll = null

  switch (overlay.type) {
    case 'Help': {
      title = t(language, 'help_title_full')
      const keys = ['help_page_jump', 'help_move', 'help_tab_esc', 'help_tools_line', 'help_updates_line', 'help_global_line', 'help_config_line', 'text_search_hint']
      const content = scrollContent(keys.flatMap(key => wrap(t(language, key), contentWidth)), overlay.scroll, capacity)
      lines = content.lines
      counter = content.counter
      maxScroll = content.maxScroll
      break
    }
    case 'Search':
      title = t(language, 'search_title')
      lines = [inputLine(t(language, 'search_prompt', { query: '' }), s.search, contentWidth)]
      break
    case 'ConfigTarget': {
      title = t(language, 'config_target_title')
      if (overlay.mode === 'path') {
        const content = scrollContent([
          ...(overlay.error ? wrap(overlay.error, contentWidth) : []),
          ...wrap(overlay.input, contentWidth),
        ], overlay.scroll, capacity - 1)
        lines = [inputLine(t(language, 'config_target_path'), overlay.input, contentWidth), ...content.lines]
        maxScroll = content.maxScroll
        counter = content.maxScroll ? `PgUp/PgDn ${content.counter}` : ''
        break
      }
      const items = app.configTargetItems(overlay)
      const current = items[overlay.selected]
      const context = [
        ...(overlay.error ? wrap(overlay.error, contentWidth) : []),
        ...(current?.supported === false ? [t(language, 'config_target_unsupported')] : []),
        ...(current?.path ? wrap(current.path, contentWidth) : []),
      ]
      const pathContent = scrollContent(context, overlay.scroll, Math.max(1, capacity - 4))
      const visibleHeader = [inputLine(t(language, 'search_prompt', { query: '' }), overlay.search, contentWidth), ...pathContent.lines]
      maxScroll = pathContent.maxScroll
      const entries = items.map((item) => {
        if (item.kind === 'path')
          return t(language, 'config_target_input')
        if (item.kind === 'project')
          return t(language, 'config_target_project')
        const marker = item.path === s.configTarget?.path ? '●' : '○'
        const unsupported = item.supported ? '' : ` [${t(language, 'config_target_unsupported')}]`
        return `${marker} ${clipPath(displayPath(item.path), contentWidth - 2 - stringWidth(unsupported))}${unsupported}`
      })
      const content = windowContent(entries, overlay.selected, capacity - visibleHeader.length)
      lines = [...visibleHeader, ...content.lines]
      selected = content.selected < 0 ? -1 : visibleHeader.length + content.selected
      counter = pathContent.maxScroll ? `PgUp/PgDn ${pathContent.counter}  ${content.counter}` : content.counter
      break
    }
    case 'Picker': {
      title = t(language, { registry: 'picker_registry', backends: 'picker_backends', versions: 'picker_versions' }[overlay.level])
      ;({ lines, selected, counter, maxScroll } = renderPickerContent(overlay, s, contentWidth, capacity))
      break
    }
    case 'CommandPalette': {
      title = t(language, overlay.context ? 'command_context' : 'command_palette')
      const query = inputLine(t(language, 'search_prompt', { query: '' }), overlay.search || '', contentWidth)
      const items = filterCommands(overlay.commands || [], overlay.search)
      const content = windowContent(items.map(item => itemLine(item.name, item.description, contentWidth)), overlay.selected, Math.max(0, capacity - 1))
      lines = [query, ...(items.length ? content.lines : [t(language, 'no_matching_commands')])]
      selected = content.selected < 0 ? -1 : content.selected + 1
      counter = content.counter
      break
    }
    case 'CommandBuilder': {
      title = t(language, 'command_builder', { command: `mise ${overlay.command?.name || ''}` })
      const help = overlay.loading ? t(language, 'loading') : overlay.error || overlay.help || ''
      const helpContent = scrollContent(wrap(help, contentWidth), overlay.scroll, Math.max(0, capacity - 1))
      lines = [inputLine(t(language, 'command_builder_args', { args: '' }), overlay.args || '', contentWidth), ...helpContent.lines]
      selected = overlay.mode === 'input'
        ? 0
        : helpContent.lines.length ? (overlay.scroll >= helpContent.maxScroll && helpContent.maxScroll > 0 ? lines.length - 1 : 1) : -1
      counter = helpContent.counter
      maxScroll = helpContent.maxScroll
      break
    }
    case 'CustomTool': {
      title = t(language, 'custom_tool')
      const content = scrollContent([
        ...(overlay.error ? wrap(overlay.error, contentWidth) : []),
        ...wrap(targetHint(s), contentWidth),
      ], overlay.scroll, capacity - 1)
      lines = [inputLine(t(language, 'custom_tool_prompt'), overlay.input || '', contentWidth), ...content.lines]
      maxScroll = content.maxScroll
      counter = content.maxScroll ? `PgUp/PgDn ${content.counter}` : ''
      break
    }
    case 'ConfirmDelete':
    case 'ConfirmCommand': {
      title = t(language, overlay.type === 'ConfirmDelete' ? 'confirm_delete_title' : 'confirm_command_title')
      const content = scrollContent(wrap(overlay.message || '', contentWidth), overlay.scroll, capacity)
      lines = content.lines
      counter = content.counter
      maxScroll = content.maxScroll
      break
    }
  }

  lines = lines.slice(0, capacity).map(line => clipColumns(line, contentWidth))
  // Hints remain on the bottom row even while long content scrolls above them.
  lines.push(clipColumns(overlayHint(overlay, language), contentWidth))
  const left = Math.floor((width - modalWidth) / 2)
  const renderedHeight = lines.length + 2
  const top = Math.floor((height - renderedHeight) / 2)
  renderBox(nodes, 'modal', box('modal', left, top, modalWidth, renderedHeight, { title, lines, selected, counter }, COLORS.focus))
  return maxScroll
}

function renderPickerContent(overlay, s, contentWidth, capacity) {
  const { language } = s
  let entries = []
  let emptyKey = 'no_results'
  const header = wrap(overlay.intent === 'Install' ? t(language, 'install_only_hint') : targetHint(s), contentWidth)
  switch (overlay.level) {
    case 'registry': {
      const filter = overlay.backends?.[overlay.filterIdx || 0] || 'All'
      header.push(t(language, 'picker_filter_label', { filter: filter === 'All' ? t(language, 'all_backends') : filter, query: `${overlay.search || ''}${overlay.searching ? '█' : ''}` }))
      entries = filterRegistryTools(overlay).map(item => itemLine(item.name, item.description, contentWidth))
      break
    }
    case 'backends':
      entries = overlay.backendList || []
      emptyKey = 'no_backends'
      break
    case 'versions':
      header.push(clipPath(overlay.toolSpecName || '', contentWidth))
      entries = (overlay.versions || []).map(item => itemLine(item.version, item.created_at || '', contentWidth))
      emptyKey = 'no_versions'
      break
  }
  if (overlay.loading)
    header.push(t(language, overlay.level === 'registry' ? 'loading_registry' : 'loading_versions'))
  if (overlay.error)
    header.unshift(...wrap(overlay.error, contentWidth))
  const context = scrollContent(header, overlay.scroll, Math.max(0, capacity - 1))
  const visibleHeader = context.lines
  const content = windowContent(entries, Math.max(0, Math.min(overlay.selected || 0, entries.length - 1)), capacity - visibleHeader.length)
  return {
    lines: [...visibleHeader, ...(entries.length ? content.lines : [t(language, emptyKey)])],
    selected: content.selected < 0 ? -1 : content.selected + visibleHeader.length,
    counter: context.maxScroll ? `PgUp/PgDn ${context.counter}  ${content.counter}` : content.counter,
    maxScroll: context.maxScroll,
  }
}
