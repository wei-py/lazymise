import { fg, StyledText, TextRenderable } from '@opentui/core'
import stringWidth from 'string-width'
import { t } from '../config/i18n.js'
import { clipColumns, FOCUS, layoutMode } from './state.js'
import { COLORS, setTheme } from './view/colors.js'
import { pageActionsHint } from './view/hints.js'
import { renderOverlay } from './view/overlay.js'
import { detailViewport, listContent, navContent } from './view/panels.js'
import {
  box,
  clipPath,
  displayPath,
  padColumns,
  panel,
  renderBox,
  showNode,
  wrap,
} from './view/primitives.js'

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
    const mode = layoutMode(width, height)

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

    // Header bar
    const prefix = ` LAZYMISE  ${t(language, 'config_target_header')} `
    const suffix = `  ${t(language, 'config_target_select_hint')} `
    const target = s.configTarget
      ? displayPath(s.configTarget.path)
      : t(language, 'config_target_none')
    const headerLine = `${prefix}${clipPath(target, width - stringWidth(prefix + suffix))}${suffix}`
    showNode(
      nodes,
      'header',
      0,
      0,
      width,
      1,
      [padColumns(headerLine, width)],
      COLORS.text,
      COLORS.selection,
    )

    if (mode === 'dual') {
      const navWidth = Math.floor((width - 2) / 5)
      const listWidth = Math.floor((width - navWidth - 2) / 2)
      const detailLeft = navWidth + listWidth + 2
      const detailWidth = width - detailLeft
      const panelHeight = height - 6
      const detailHeight = panelHeight

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
      const topHeight = Math.floor((height - 6) * 0.55)
      const bottomHeight = height - 6 - topHeight

      const focusedPane = s.focus
      const topId = focusedPane === FOCUS.Navigation ? 'nav' : 'list'
      const bottomId = focusedPane === FOCUS.Details ? 'detail' : topId === 'nav' ? 'list' : 'nav'
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

    // Status: bordered box above the key hints (lazyapp-style footer).
    const status = renderStatus(s)
    renderBox(
      nodes,
      'status',
      box(
        'status',
        0,
        height - 5,
        width,
        4,
        {
          title: t(language, status.busy ? 'Working' : 'Status'),
          lines: wrap(status.text, width - 3),
        },
        COLORS.border,
        status.busy ? COLORS.warning : COLORS.muted,
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
    return { width, height, detailMaxScroll, overlayMaxScroll }
  }
}

function renderStatus(s) {
  if (s.loading)
    return { text: t(s.language, 'loading'), busy: true }
  const active = (s.consoleTasks || []).filter(
    t => t.status === 'pending' || t.status === 'running',
  )
  const prefix = active.length
    ? `${t(s.language, 'status_running_count', { count: active.length })} `
    : ''
  return {
    text: prefix + (s.status || t(s.language, 'status_ready')),
    busy: active.length > 0,
  }
}
