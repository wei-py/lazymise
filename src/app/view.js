import { homedir } from 'node:os'
import { BoxRenderable, fg, TextRenderable } from '@opentui/core'
import stringWidth from 'string-width'
import { JOB_GLYPH } from '../../vendor/lazy-kit/jobs.js'
import { t } from '../config/i18n.js'
import { clipColumns, FOCUS, GROUPS, layoutMode } from './state.js'
import { COLORS, setTheme } from './view/colors.js'
import { pageActionsHint } from './view/hints.js'
import { renderOverlay } from './view/overlay.js'
import { detailViewport, listContent } from './view/panels.js'
import { box, panel, renderBox, showNode } from './view/primitives.js'

const PANEL_IDS = [...GROUPS.map(group => group.id), 'detail']
const NODE_IDS = [
  'header',
  'headerInner',
  'navigationFrame',
  'navigationInner',
  ...PANEL_IDS.flatMap(id => [`${id}Frame`, `${id}Inner`, `${id}Selection`]),
  'statusFrame',
  'statusInner',
  'keysFrame',
  'keysInner',
  'keys',
  'modalFrame',
  'modalTitle',
  'modalInner',
  'modalSelection',
]

/** Create the view function that renders application state. */
export function createView(renderer) {
  const nodes = {}
  let background
  let detectedMode = renderer.themeMode === 'light' ? 'light' : 'dark'
  let lastState
  let lastApp
  let marqueeTimer
  let marqueeStep = 0
  let marqueeContext = []
  for (const id of NODE_IDS) {
    const Renderable = id === 'modalFrame' ? BoxRenderable : TextRenderable
    nodes[id] = new Renderable(renderer, {
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
      ...(id === 'modalFrame' ? { border: true, borderStyle: 'single', backgroundColor: COLORS.surface } : {}),
    })
    renderer.root.add(nodes[id])
  }

  function render(s, app) {
    lastState = s
    lastApp = app
    const { width, height } = renderer
    const { language } = s
    const context = [s.focus, s.focusedGroup, s.groupTabs[s.focusedGroup], s.selected, s.search, s.language, s.toolScope, s.toolViewInstalled, s.snapshot, s.overlay, width, height]
    if (context.some((value, index) => value !== marqueeContext[index])) {
      marqueeStep = 0
      marqueeContext = context
      clearTimeout(marqueeTimer)
      marqueeTimer = undefined
    }
    let scrolling = false
    setTheme(s.theme, detectedMode)
    // TextRenderable.bg paints glyph cells only; the canvas owns all remaining cells.
    if (background !== COLORS.background) {
      background = COLORS.background
      renderer.setBackgroundColor(background)
    }
    for (const node of Object.values(nodes)) node.visible = false
    const mode = layoutMode(width, height)
    let detailMaxScroll = null
    let listCapacity = null
    let listStart = null
    let detailCapacity = null
    const jobs = s.jobs || []
    const activeJobs = jobs.filter(job => job.state === 'queued' || job.state === 'running')
    const settledJobs = jobs.filter(job => job.state !== 'queued' && job.state !== 'running')
    const shownJobs = [...activeJobs, ...settledJobs.slice(-1)].slice(0, 1)
    const headerHeight = height >= 12 ? 1 : 0
    const statusHeight = height >= 12 ? 1 : 0
    const workspaceTop = headerHeight + 3
    const available = Math.max(0, height - workspaceTop - statusHeight - 3)

    if (mode === 'small') {
      showNode(nodes, 'header', 0, 0, width, 1, [t(language, 'Terminal too small')], COLORS.warning)
      showNode(nodes, 'keys', 0, Math.max(0, height - 1), width, 1, [t(language, 'small_hint')], COLORS.muted)
      const overlayMaxScroll = s.overlay ? renderOverlay(nodes, s, app, width, height, renderer.widthMethod) : null
      renderer.requestRender()
      return { width, height, detailMaxScroll, overlayMaxScroll, listCapacity }
    }

    const contextPath = s.configTarget ? headerPath(s.configTarget.path) : t(language, 'config_target_none')
    if (headerHeight)
      showNode(nodes, 'header', 0, 0, width, 1, [` LAZYMISE │ ${contextPath} │ ${language}`], COLORS.focus)
    const navigationFocused = s.focus === FOCUS.Navigation
    const navigation = GROUPS.map((group, index) => {
      const active = index === s.focusedGroup
      const segmentWidth = Math.floor((width - 3) / GROUPS.length)
      const label = clipColumns(`${active ? '▸' : ' '} [${index + 1}] ${t(language, group.pages[0])}`, segmentWidth - 1)
      const text = label + ' '.repeat(Math.max(0, segmentWidth - stringWidth(label)))
      return fg(active ? navigationFocused ? COLORS.selectionText : COLORS.focus : COLORS.muted)(text)
    })
    renderBox(nodes, 'navigation', box('navigation', 0, headerHeight, width, 3, { lines: [navigation] }, navigationFocused ? COLORS.focus : COLORS.border, COLORS.muted, navigationFocused ? COLORS.selection : COLORS.background))

    const renderGroup = (index, left, top, panelWidth, panelHeight) => {
      const group = GROUPS[index]
      const page = s.groupTabs[index]
      const position = app.pageState(page)
      const rows = Math.max(0, panelHeight - 2)
      const context = [
        ...(page === 'Tools' ? [t(language, position.toolViewInstalled ? 'tool_view_installed' : position.toolScope === 'global' ? 'tool_scope_global' : 'tool_scope_project')] : []),
        ...(position.search ? [`/ ${position.search}`] : []),
      ].join(' · ')
      const contextRows = context && rows > 1 ? 1 : 0
      const content = listContent(position, app.visibleItems(position), rows - contextRows, panelWidth - 3, {
        enabled: !s.overlay && s.focus === group.id && rows > contextRows,
        step: marqueeStep,
      })
      scrolling ||= content.scrolling
      if (contextRows) {
        content.lines.unshift(context)
        if (content.selected >= 0)
          content.selected++
      }
      content.titleTabs = group.pages.map(tab => ({ text: t(language, tab), active: tab === page }))
      renderBox(nodes, group.id, panel(group.id, left, top, panelWidth, panelHeight, content, s))
      listCapacity = Math.max(1, rows - contextRows)
      listStart = content.start ?? 0
    }
    const renderDetail = (left, top, panelWidth, panelHeight) => {
      detailCapacity = Math.max(0, panelHeight - 2)
      const detail = detailViewport(s, app.visibleItems(), panelWidth - 3, detailCapacity)
      detailMaxScroll = detail.maxScroll
      renderBox(nodes, 'detail', panel('detail', left, top, panelWidth, panelHeight, detail, s))
    }

    if (width >= 80) {
      const detailWidth = Math.max(28, Math.floor(width * 0.3))
      const listWidth = width - detailWidth
      renderGroup(s.focusedGroup, 0, workspaceTop, listWidth, available)
      renderDetail(listWidth, workspaceTop, detailWidth, available)
    }
    else if (s.focus === FOCUS.Details) {
      renderDetail(0, workspaceTop, width, available)
    }
    else {
      renderGroup(s.focusedGroup, 0, workspaceTop, width, available)
    }

    const status = renderStatus(s, app, shownJobs, activeJobs.length)
    if (statusHeight)
      showNode(nodes, 'statusInner', 0, height - statusHeight - 3, width, statusHeight, status.lines.slice(0, statusHeight), COLORS.text, COLORS.background, status.colors)

    const hintState = s.focus === FOCUS.Details || s.focus === FOCUS.Navigation ? s : app.pageState(s.groupTabs[s.focusedGroup])
    const parts = s.overlay
      ? []
      : [
          { text: '1–4 ', color: COLORS.focus },
          { text: `${t(language, 'hint_modules')}  `, color: COLORS.muted },
          { text: '[] ', color: COLORS.focus },
          { text: `${t(language, 'hint_tabs')}  `, color: COLORS.muted },
          { text: 'Tab ', color: COLORS.focus },
          { text: `${t(language, 'hint_focus')}  `, color: COLORS.muted },
          { text: '? ', color: COLORS.focus },
          { text: `${t(language, 'hint_help')}  `, color: COLORS.muted },
        ]
    for (const chip of pageActionsHint(hintState)) {
      parts.push({ text: `${chip.key} `, color: COLORS.focus })
      if (chip.desc)
        parts.push({ text: `${chip.desc}  `, color: COLORS.muted })
    }
    const segments = []
    let columns = 0
    for (const part of parts) {
      const size = stringWidth(part.text)
      segments.push(fg(part.color)(clipColumns(part.text, Math.max(0, width - 3 - columns))))
      columns += size
      if (columns >= width - 3)
        break
    }
    renderBox(nodes, 'keys', box('keys', 0, height - 3, width, 3, { lines: [segments] }, COLORS.border, COLORS.muted))
    const overlayMaxScroll = s.overlay ? renderOverlay(nodes, s, app, width, height, renderer.widthMethod) : null
    if (scrolling && !marqueeTimer) {
      marqueeTimer = setTimeout(() => {
        marqueeTimer = undefined
        marqueeStep++
        if (lastState)
          render(lastState, lastApp)
      }, 180)
      marqueeTimer.unref?.()
    }
    else if (!scrolling) {
      clearTimeout(marqueeTimer)
      marqueeTimer = undefined
      marqueeStep = 0
    }
    renderer.requestRender()
    return { width, height, detailMaxScroll, overlayMaxScroll, listCapacity, listStart, detailCapacity }
  }

  function onThemeMode(mode) {
    const nextMode = mode === 'light' ? 'light' : 'dark'
    if (nextMode === detectedMode)
      return
    detectedMode = nextMode
    if (lastState?.theme === 'auto')
      lastApp.update()
  }
  function dispose() {
    clearTimeout(marqueeTimer)
    marqueeTimer = undefined
    renderer.off('theme_mode', onThemeMode)
    renderer.off('destroy', dispose)
    lastState = undefined
    lastApp = undefined
  }
  renderer.on('theme_mode', onThemeMode)
  renderer.once('destroy', dispose)
  render.dispose = dispose
  return render
}

function renderStatus(s, app, shownJobs, activeCount) {
  const hiddenJobs = (s.jobs || []).length - shownJobs.length
  const stateText = activeCount
    ? `${t(s.language, '{count} active', { count: activeCount })}${hiddenJobs > 0 ? ` +${hiddenJobs}` : ''}`
    : s.loading
      ? t(s.language, 'checking…')
      : t(s.language, 'idle')
  const lastLog = app.runner.log().at(-1) || ''
  return {
    lines: [
      [
        s.status ? `${stateText} │ ${s.status}` : stateText,
        shownJobs.length ? jobRow(s, shownJobs[0]) : lastLog ? `» ${lastLog}` : '',
      ].filter(Boolean).join(' │ '),
    ],
    colors: [activeCount ? COLORS.warning : s.status ? COLORS.text : COLORS.muted],
  }
}

function jobRow(s, job) {
  let detail = job.lastLine
  if (job.state === 'queued')
    detail = t(s.language, 'waiting for other jobs')
  if (job.endedAt !== null) {
    const seconds = `${Math.max(
      1,
      Math.round((job.endedAt - (job.startedAt ?? job.endedAt)) / 1000),
    )}s`
    if (job.state === 'canceled')
      detail = t(s.language, 'canceled · {seconds}', { seconds })
    else if (job.startedAt !== null)
      detail = t(s.language, 'exit {code} · {seconds}', { code: job.exitCode, seconds })
  }
  return `${JOB_GLYPH[job.state]} ${job.label}  ${detail}`
}

function headerPath(path) {
  const home = homedir()
  if (path === home)
    return '~'
  if (path.startsWith(`${home}/`))
    return `~${path.slice(home.length)}`
  return path
}
