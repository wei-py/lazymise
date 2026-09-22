import { relative } from 'node:path'
import { fg, StyledText } from '@opentui/core'
import stringWidth from 'string-width'
import { clipColumns } from '../state.js'
import { COLORS } from './colors.js'

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })

const PANEL_FOCUS = { nav: 'Navigation', list: 'List', detail: 'Details' }

export function padColumns(value, width) {
  const clipped = clipColumns(value, width)
  return `${clipped}${' '.repeat(Math.max(0, width - stringWidth(clipped)))}`
}

/** Wrap text to fit within a given width, preserving newlines. */
export function wrap(value, width) {
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
export function windowContent(lines, index, size) {
  const count = Math.max(0, size)
  const start = Math.min(
    Math.max(0, index - Math.floor(count / 2)),
    Math.max(0, lines.length - count),
  )
  return {
    lines: lines.slice(start, start + count),
    start,
    selected: lines.length ? index - start : -1,
    counter: `${lines.length ? index + 1 : 0}/${lines.length}`,
  }
}

export function box(
  id,
  left,
  top,
  width,
  height,
  content,
  frameColor = COLORS.border,
  color = COLORS.text,
  background = COLORS.background,
) {
  if (width < 4 || height < 2)
    return false
  const innerWidth = width - 2
  const innerHeight = height - 2
  const label = clipColumns(` ${content.title || ''} `, innerWidth)
  const counter = content.counter ? clipColumns(` ${content.counter} `, innerWidth) : ''

  const border = {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│',
  }

  const frame = [
    `${border.topLeft}${label}${border.horizontal.repeat(innerWidth - stringWidth(label))}${border.topRight}`,
    ...Array.from(
      { length: innerHeight },
      () => `${border.vertical}${' '.repeat(innerWidth)}${border.vertical}`,
    ),
    `${border.bottomLeft}${border.horizontal.repeat(innerWidth - stringWidth(counter))}${counter}${border.bottomRight}`,
  ]

  return {
    frame: { left, top, width, height, lines: frame, color: frameColor, background },
    inner: {
      left: left + 1,
      top: top + 1,
      width: innerWidth,
      height: innerHeight,
      lines: content.lines.map(line => ` ${line}`),
      color,
      background,
      colors: content.colors,
      selected: content.selected,
      selectedLine: content.lines[content.selected] || '',
    },
  }
}

/** Render a bordered panel with focus-aware frame color. */
export function panel(id, left, top, width, height, content, s) {
  const focused = PANEL_FOCUS[id] === s.focus
  return box(
    id,
    left,
    top,
    width,
    height,
    { ...content, title: focused ? `[${content.title}]` : content.title },
    focused ? COLORS.focus : COLORS.border,
  )
}

/** Show a single TextRenderable node. */
export function showNode(
  nodes,
  id,
  left,
  top,
  width,
  height,
  lines,
  color = COLORS.text,
  background = COLORS.background,
  colors,
) {
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
    node.content = new StyledText(
      visible.map((line, index) => fg(colors[index] || color)(`${index ? '\n' : ''}${line}`)),
    )
  }
  else {
    node.content = visible.join('\n')
  }
}

/** Render a box result onto nodes. */
export function renderBox(nodes, id, boxResult) {
  if (!boxResult)
    return
  showNode(
    nodes,
    `${id}Frame`,
    boxResult.frame.left,
    boxResult.frame.top,
    boxResult.frame.width,
    boxResult.frame.height,
    boxResult.frame.lines,
    boxResult.frame.color,
    boxResult.frame.background,
  )
  showNode(
    nodes,
    `${id}Inner`,
    boxResult.inner.left,
    boxResult.inner.top,
    boxResult.inner.width,
    boxResult.inner.height,
    boxResult.inner.lines,
    boxResult.inner.color,
    boxResult.inner.background,
    boxResult.inner.colors,
  )
  if (boxResult.inner.selected >= 0 && boxResult.inner.selected < boxResult.inner.height) {
    showNode(
      nodes,
      `${id}Selection`,
      boxResult.inner.left,
      boxResult.inner.top + boxResult.inner.selected,
      boxResult.inner.width,
      1,
      [padColumns(boxResult.inner.lines[boxResult.inner.selected] || '', boxResult.inner.width)],
      COLORS.selectionText,
      COLORS.selection,
    )
  }
}

export function inputLine(label, value, width) {
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

export function itemLine(name, description, width) {
  const nameWidth = Math.min(25, Math.floor((width - 2) / 2))
  return `${padColumns(name, nameWidth)}  ${clipColumns(description, width - nameWidth - 2)}`
}

export function displayPath(path) {
  const local = relative(process.cwd(), path)
  return local && local !== '..' && !local.startsWith('../') ? `./${local}` : path
}

export function clipPath(path, width) {
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

export function scrollContent(lines, scroll, capacity) {
  const start = Math.max(0, Math.min(scroll || 0, Math.max(0, lines.length - capacity)))
  return {
    lines: lines.slice(start, start + capacity),
    counter: `${lines.length ? start + 1 : 0}–${Math.min(lines.length, start + capacity)}/${lines.length}`,
    maxScroll: Math.max(0, lines.length - capacity),
  }
}
