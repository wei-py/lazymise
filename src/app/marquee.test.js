import { expect, test } from 'bun:test'
import stringWidth from 'string-width'
import { listContent } from './view/panels.js'
import { scrollColumns } from './view/primitives.js'

test('scrolling holds both ends, loops, and never splits grapheme clusters', () => {
  for (const [value, width, step, expected] of [
    ['abcdefgh', 4, 0, 'abc…'],
    ['abcdefgh', 4, 5, 'abc…'],
    ['abcdefgh', 4, 6, 'bcd…'],
    ['abcdefgh', 4, 9, 'efgh'],
    ['abcdefgh', 4, 13, 'efgh'],
    ['abcdefgh', 4, 14, 'abc…'],
    ['工具版本', 4, 6, ' 具…'],
    ['工具版本', 4, 7, '具…'],
    ['工具版本', 4, 9, '版本'],
    ['e\u0301abcdef', 4, 6, 'abc…'],
    ['👩‍💻abcdef', 4, 7, 'abc…'],
    ['short', 10, 100, 'short'],
    ['long', 0, 6, ''],
  ]) {
    const result = scrollColumns(value, width, step)
    expect(result).toBe(expected)
    expect(stringWidth(result)).toBeLessThanOrEqual(width)
  }
})

test('selected tool fields reveal their tails while other rows and status columns stay fixed', () => {
  const tool = {
    name: 'github:example/工具-name-ending',
    version: '2026.10.30-long-version-tail',
    installed: true,
    active: false,
    scope: 'global',
  }
  const state = { page: 'Tools', language: 'zh', toolScope: 'project', selected: 0 }
  const items = [tool, { ...tool, name: 'github:other/unchanged-long-name' }]
  const start = listContent(state, items, 2, 38, { enabled: true, step: 0 })
  expect(start.scrolling).toBe(true)
  const unselected = start.lines[1]
  let nameTail = false
  let versionTail = false
  for (let step = 0; step < 100; step++) {
    const frame = listContent(state, items, 2, 38, { enabled: true, step })
    expect(frame.lines[1]).toBe(unselected)
    expect(frame.lines[0].startsWith('● ↑ ')).toBe(true)
    expect(frame.lines[0].endsWith('(非活跃)')).toBe(true)
    expect(stringWidth(frame.lines[0])).toBeLessThanOrEqual(38)
    nameTail ||= frame.lines[0].includes('ending')
    versionTail ||= frame.lines[0].includes('tail')
  }
  expect(nameTail).toBe(true)
  expect(versionTail).toBe(true)
  const paused = listContent(state, items, 2, 38, { enabled: false, step: 50 })
  expect(paused.scrolling).toBe(false)
  expect(paused.lines).toEqual(start.lines)
})
