import { homedir } from 'node:os'
import { fg, StyledText, TextRenderable } from '@opentui/core'
import stringWidth from 'string-width'
import { JOB_GLYPH } from '../../vendor/lazy-kit/jobs.js'
import { t } from '../config/i18n.js'
import { clipColumns, FOCUS, layoutMode } from './state.js'
import { COLORS, setTheme } from './view/colors.js'
import { pageActionsHint } from './view/hints.js'
import { renderOverlay } from './view/overlay.js'
import { detailViewport, listContent, navContent } from './view/panels.js'
import { box, panel, renderBox, showNode } from './view/primitives.js'

const PANEL_IDS = ['nav', 'list', 'detail']
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
    setTheme(s.theme)
    const items = app.visibleItems()
    let detailMaxScroll = 0
    let listRows = 0
    const mode = layoutMode(width, height)

    // Job rows drive the dynamic status box height, which drives the panels.
    const jobs = s.jobs || []
    const activeJobs = jobs.filter(job => job.state === 'queued' || job.state === 'running')
    const settledJobs = jobs.filter(job => job.state !== 'queued' && job.state !== 'running')
    const shownJobs = [
      ...activeJobs,
      ...settledJobs.slice(Math.max(0, settledJobs.length - 1)),
    ].slice(0, 3)
    const statusHeight = 4 + shownJobs.length
    const available = Math.max(0, height - statusHeight - 2)

    // Hide all nodes first
    for (const node of Object.values(nodes)) node.visible = false

    if (mode === 'small') {
      showNode(
        nodes,
        'header',
        0,
        0,
        width,
        1,
        [t(language, 'Terminal too small')],
        COLORS.warning,
      )
      showNode(
        nodes,
        'keys',
        0,
        height - 1,
        width,
        1,
        [t(language, 'Resize, or q/Ctrl-c to quit')],
        COLORS.muted,
      )
      renderer.requestRender()
      return { width, height, detailMaxScroll }
    }

    // Header: one borderless line, right-aligned zh/en language chip.
    const prefix = ' LAZYMISE │ '
    const contextPath = s.configTarget
      ? headerPath(s.configTarget.path)
      : t(language, 'config_target_none')
    const chipPlain = 'zh en'
    const budget = Math.max(3, width - prefix.length - chipPlain.length - 1)
    const shownPath
      = contextPath.length > budget ? `${contextPath.slice(0, budget - 1)}…` : contextPath
    const pad = ' '.repeat(
      Math.max(1, width - prefix.length - shownPath.length - chipPlain.length),
    )
    const headerNode = nodes.header
    headerNode.visible = true
    Object.assign(headerNode, { left: 0, top: 0, width, height: 1, bg: COLORS.background })
    headerNode.content = new StyledText([
      fg(COLORS.text)(' '),
      fg(COLORS.focus)('LAZYMISE'),
      fg(COLORS.border)(' │ '),
      fg(COLORS.repo)(shownPath),
      fg(COLORS.text)(pad),
      fg(s.language === 'zh' ? COLORS.focus : COLORS.muted)('zh'),
      fg(COLORS.border)(' '),
      fg(s.language === 'en' ? COLORS.focus : COLORS.muted)('en'),
    ])

    if (mode === 'dual') {
      const navWidth = Math.floor((width - 2) / 5)
      const listWidth = Math.floor((width - navWidth - 2) / 2)
      const detailLeft = navWidth + listWidth + 2
      const detailWidth = width - detailLeft
      const panelHeight = available
      const detailHeight = panelHeight
      listRows = Math.max(0, panelHeight - 2)

      const navResult = panel(
        'nav',
        1,
        1,
        navWidth,
        panelHeight,
        navContent(s, panelHeight - 2),
        s,
      )
      renderBox(nodes, 'nav', navResult)

      const listResult = panel(
        'list',
        navWidth + 1,
        1,
        listWidth,
        panelHeight,
        listContent(s, items, panelHeight - 2, listWidth - 3),
        s,
      )
      renderBox(nodes, 'list', listResult)

      const detail = detailViewport(s, items, detailWidth - 3, detailHeight - 2)
      detailMaxScroll = detail.maxScroll
      const detailResult = panel('detail', detailLeft, 1, detailWidth, detailHeight, detail, s)
      renderBox(nodes, 'detail', detailResult)
    }
    else {
      // Single mode: stacked layout
      const topHeight = Math.floor(available * 0.55)
      const bottomHeight = available - topHeight

      const focusedPane = s.focus
      const topId = focusedPane === FOCUS.Navigation ? 'nav' : 'list'
      const bottomId = focusedPane === FOCUS.Details ? 'detail' : topId === 'nav' ? 'list' : 'nav'
      listRows = Math.max(0, (topId === 'list' ? topHeight : bottomHeight) - 2)
      const detail = detailViewport(s, items, width - 5, bottomHeight - 2)
      detailMaxScroll = detail.maxScroll
      const contentFor = (id, capacity) =>
        id === 'nav'
          ? navContent(s, capacity)
          : id === 'list'
            ? listContent(s, items, capacity, width - 5)
            : detail

      const topResult = panel(
        topId,
        1,
        1,
        width - 2,
        topHeight,
        contentFor(topId, topHeight - 2),
        s,
      )
      renderBox(nodes, topId, topResult)

      const bottomResult = panel(
        bottomId,
        1,
        1 + topHeight,
        width - 2,
        bottomHeight,
        contentFor(bottomId, bottomHeight - 2),
        s,
      )
      renderBox(nodes, bottomId, bottomResult)
    }

    // Status: counts row + job rows + log row, growing with visible jobs.
    const status = renderStatus(s, app, shownJobs, activeJobs.length)
    renderBox(
      nodes,
      'status',
      box(
        'status',
        0,
        height - statusHeight - 1,
        width,
        statusHeight,
        {
          title: t(language, 'Status'),
          lines: status.lines,
          colors: status.colors,
          titleColor: activeJobs.length ? COLORS.warning : COLORS.muted,
        },
        activeJobs.length ? COLORS.warning : COLORS.border,
        COLORS.text,
        COLORS.background,
      ),
    )

    // Key hints: prefix + colored chips (`key · desc`), clipped at the right edge.
    const keysNode = nodes.keys
    keysNode.visible = true
    Object.assign(keysNode, {
      left: 0,
      top: height - 1,
      width,
      height: 1,
      fg: COLORS.muted,
      bg: COLORS.background,
    })
    const chipParts = [{ text: `${t(language, s.page)}: `, color: COLORS.focus }]
    for (const [index, chip] of pageActionsHint(s).entries()) {
      if (index)
        chipParts.push({ text: '  ·  ', color: COLORS.border })
      chipParts.push({ text: chip.key, color: COLORS.focus })
      if (chip.desc)
        chipParts.push({ text: ` ${chip.desc}`, color: COLORS.muted })
    }
    const chipSegments = []
    let chipColumns = 0
    for (const part of chipParts) {
      const size = stringWidth(part.text)
      if (chipColumns + size > width) {
        chipSegments.push(fg(part.color)(clipColumns(part.text, Math.max(0, width - chipColumns))))
        break
      }
      chipSegments.push(fg(part.color)(part.text))
      chipColumns += size
    }
    keysNode.content = new StyledText(chipSegments)

    // Overlay rendering
    const overlayMaxScroll = s.overlay ? renderOverlay(nodes, s, app, width, height) : null

    renderer.requestRender()
    return { width, height, detailMaxScroll, overlayMaxScroll, listCapacity: listRows }
  }
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
