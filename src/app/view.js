import { homedir } from 'node:os'
import { fg, TextRenderable } from '@opentui/core'
import stringWidth from 'string-width'
import { JOB_GLYPH } from '../../vendor/lazy-kit/jobs.js'
import { t } from '../config/i18n.js'
import { clipColumns, FOCUS, GROUPS, layoutMode } from './state.js'
import { COLORS, setTheme } from './view/colors.js'
import { pageActionsHint } from './view/hints.js'
import { renderOverlay } from './view/overlay.js'
import { detailViewport, listContent } from './view/panels.js'
import { panel, renderBox, showNode } from './view/primitives.js'

const PANEL_IDS = [...GROUPS.map(group => group.id), 'detail']
const NODE_IDS = [
  'header',
  'headerInner',
  ...PANEL_IDS.flatMap(id => [`${id}Frame`, `${id}Inner`, `${id}Selection`]),
  'statusFrame',
  'statusInner',
  'keys',
  'modalFrame',
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
    let detailCapacity = null
    const jobs = s.jobs || []
    const activeJobs = jobs.filter(job => job.state === 'queued' || job.state === 'running')
    const settledJobs = jobs.filter(job => job.state !== 'queued' && job.state !== 'running')
    const shownJobs = [...activeJobs, ...settledJobs.slice(-1)].slice(0, height >= 24 ? 2 : 1)
    const statusHeight = 1 + shownJobs.length
    const available = Math.max(0, height - statusHeight - 2)

    if (mode === 'small') {
      showNode(nodes, 'header', 0, 0, width, 1, [t(language, 'Terminal too small')], COLORS.warning)
      showNode(nodes, 'keys', 0, Math.max(0, height - 1), width, 1, [t(language, 'small_hint')], COLORS.muted)
      const overlayMaxScroll = s.overlay ? renderOverlay(nodes, s, app, width, height) : null
      renderer.requestRender()
      return { width, height, detailMaxScroll, overlayMaxScroll, listCapacity }
    }

    const contextPath = s.configTarget ? headerPath(s.configTarget.path) : t(language, 'config_target_none')
    showNode(nodes, 'header', 0, 0, width, 1, [` LAZYMISE │ ${contextPath} │ ${language}`], COLORS.focus)

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
      if (page !== s.page)
        s.pagePositions[page].listStart = position.listStart
      if (index === s.focusedGroup)
        listCapacity = Math.max(1, rows - contextRows)
    }
    const renderDetail = (left, top, panelWidth, panelHeight) => {
      detailCapacity = Math.max(0, panelHeight - 2)
      const detail = detailViewport(s, app.visibleItems(), panelWidth - 3, detailCapacity)
      detailMaxScroll = detail.maxScroll
      renderBox(nodes, 'detail', panel('detail', left, top, panelWidth, panelHeight, detail, s))
    }

    if (mode === 'wide') {
      const leftWidth = Math.min(46, Math.max(34, Math.floor(width * 0.36)))
      const expandedHeight = available - 3 * (GROUPS.length - 1)
      let top = 1
      for (let index = 0; index < GROUPS.length; index++) {
        const groupHeight = index === s.focusedGroup ? expandedHeight : 3
        renderGroup(index, 0, top, leftWidth, groupHeight)
        top += groupHeight
      }
      renderDetail(leftWidth, 1, width - leftWidth, available)
    }
    else if (mode === 'focused') {
      const leftWidth = Math.max(30, Math.floor(width * 0.4))
      renderGroup(s.focusedGroup, 0, 1, leftWidth, available)
      renderDetail(leftWidth, 1, width - leftWidth, available)
    }
    else {
      const groupHeight = Math.max(4, Math.floor(available * 0.43))
      renderGroup(s.focusedGroup, 0, 1, width, groupHeight)
      renderDetail(0, 1 + groupHeight, width, available - groupHeight)
    }

    const status = renderStatus(s, app, shownJobs, activeJobs.length)
    showNode(nodes, 'statusInner', 0, height - statusHeight - 1, width, statusHeight, status.lines.slice(0, statusHeight), COLORS.text, COLORS.background, status.colors)

    const hintState = s.focus === FOCUS.Details ? s : app.pageState(s.groupTabs[s.focusedGroup])
    const parts = s.overlay
      ? []
      : [
          { text: '1–4/0 ', color: COLORS.focus },
          { text: `${t(language, 'hint_focus')}  `, color: COLORS.muted },
          { text: '[] ', color: COLORS.focus },
          { text: `${t(language, 'hint_tabs')}  `, color: COLORS.muted },
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
      segments.push(fg(part.color)(clipColumns(part.text, Math.max(0, width - columns))))
      columns += size
      if (columns >= width)
        break
    }
    showNode(nodes, 'keys', 0, height - 1, width, 1, [segments], COLORS.muted)
    const overlayMaxScroll = s.overlay ? renderOverlay(nodes, s, app, width, height) : null
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
    return { width, height, detailMaxScroll, overlayMaxScroll, listCapacity, detailCapacity }
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
      s.status ? `${stateText} │ ${s.status}` : stateText,
      ...shownJobs.map(job => jobRow(s, job)),
      lastLog ? `» ${lastLog}` : '',
    ],
    colors: [
      activeCount ? COLORS.warning : s.status ? COLORS.text : COLORS.muted,
      ...shownJobs.map(() => COLORS.text),
      activeCount ? COLORS.warning : COLORS.muted,
    ],
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
