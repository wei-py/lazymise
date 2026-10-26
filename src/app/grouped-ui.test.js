import assert from 'node:assert/strict'
import { test } from '../../support/node-test.js'
import { Application } from './controller.js'
import { confirmDelete } from './overlays.js'
import { FOCUS, GROUPS, PAGE, PAGE_ORDER } from './state.js'

function fixture(t) {
  let exits = 0
  const app = new Application(() => ({
    width: 120,
    height: 40,
    listCapacity: 6,
    detailMaxScroll: 200,
    detailCapacity: 20,
  }), () => exits++)
  const tools = ['node', 'python', 'ruby'].map((name, index) => ({ name, version: `${index + 1}`, installed: true }))
  Object.assign(app.state.snapshot, {
    tools,
    projectTools: tools,
    globalTools: tools.slice(0, 2),
    tasks: [{ name: 'build' }, { name: 'test' }],
    configs: [{ path: '/project/mise.toml', tools: ['node'] }],
    updates: [{ name: 'node', current: '1', latest: '2' }],
  })
  t.after(() => app.close())
  return { app, exits: () => exits }
}

function press(app, name, modifiers = {}) {
  app.handleKey({ name, sequence: name.length === 1 ? name : '', ...modifiers })
}

test('group focus and detail focus do not replace the active target or its viewport', (t) => {
  const { app } = fixture(t)
  app.jumpToPage(PAGE.Tools)
  app.state.selected = 2
  app.state.detailScroll = 7
  app.state.listStart = 1
  for (const key of ['2', '0', 'tab', 'tab', '3', '4']) {
    press(app, key)
    assert.equal(app.state.page, PAGE.Tools)
    assert.equal(app.state.selected, 2)
    assert.equal(app.state.detailScroll, 7)
    assert.equal(app.state.listStart, 1)
  }
  assert.equal(app.state.focus, FOCUS.Group4)
  press(app, 'enter')
  assert.equal(app.state.page, PAGE.Dashboard)
  assert.equal(app.state.focus, FOCUS.Details)
  press(app, 'escape')
  assert.equal(app.state.focus, FOCUS.Group4)
})

test('horizontal keys enter detail and return to the remembered group while Tab cycles groups', (t) => {
  const { app } = fixture(t)
  app.jumpToPage(PAGE.Tools)
  press(app, '2')
  press(app, 'right')
  assert.equal(app.state.focus, FOCUS.Details)
  assert.equal(app.state.page, PAGE.Tasks)
  press(app, 'enter')
  press(app, 'l')
  assert.equal(app.state.focus, FOCUS.Details)
  press(app, '/')
  assert.equal(app.state.overlay, null)
  press(app, 'left')
  assert.equal(app.state.focus, FOCUS.Group2)
  press(app, 'h')
  assert.equal(app.state.focus, FOCUS.Group2)
  press(app, 'tab')
  assert.equal(app.state.focus, FOCUS.Group3)
  assert.equal(app.state.page, PAGE.Tasks)
  press(app, 'backtab')
  assert.equal(app.state.focus, FOCUS.Group2)
  press(app, 'tab', { shift: true })
  assert.equal(app.state.focus, FOCUS.Group1)
})

test('paging uses the detail viewport rather than the left group row count', (t) => {
  const { app } = fixture(t)
  app.jumpToPage(PAGE.Tools)
  app.state.detailScroll = 5
  press(app, '0')
  press(app, 'pagedown')
  assert.equal(app.state.detailScroll, 15)
  press(app, 'pageup')
  assert.equal(app.state.detailScroll, 5)
})

test('list movement and paging stop at the first and last row', (t) => {
  const { app } = fixture(t)
  app.jumpToPage(PAGE.Tools)
  press(app, 'pageup')
  assert.equal(app.state.selected, 0)
  press(app, 'end')
  press(app, 'j')
  assert.equal(app.visibleItems()[app.state.selected].name, 'ruby')
  press(app, 'pagedown')
  assert.equal(app.visibleItems()[app.state.selected].name, 'ruby')
  press(app, 'home')
  press(app, 'k')
  assert.equal(app.state.selected, 0)
})

test('all nine pages are reachable through four real group tabs', (t) => {
  const { app } = fixture(t)
  const visited = new Set()
  for (const [index, group] of GROUPS.entries()) {
    press(app, String(index + 1))
    press(app, 'enter')
    visited.add(app.state.page)
    for (let tab = 1; tab < group.pages.length; tab++) {
      press(app, ']')
      visited.add(app.state.page)
    }
    assert.equal(app.state.groupTabs[index], group.pages.at(-1))
  }
  assert.deepEqual([...visited].sort(), [...PAGE_ORDER].sort())
})

test('page changes restore independent filters, rows and detail scroll', (t) => {
  const { app } = fixture(t)
  app.jumpToPage(PAGE.Tools)
  Object.assign(app.state, { search: 'y', selected: 1, detailScroll: 5, listStart: 1 })
  press(app, ']')
  assert.equal(app.state.page, PAGE.Updates)
  assert.equal(app.state.search, '')
  app.state.search = 'node'
  app.state.detailScroll = 3
  press(app, '[')
  assert.equal(app.state.page, PAGE.Tools)
  assert.equal(app.state.search, 'y')
  assert.equal(app.visibleItems()[app.state.selected].name, 'ruby')
  assert.equal(app.state.detailScroll, 5)
  assert.equal(app.state.listStart, 1)
  press(app, ']')
  assert.equal(app.state.search, 'node')
  assert.equal(app.state.detailScroll, 3)
})

test('scope switches preserve a hidden Tools page independently of the active page', (t) => {
  const { app } = fixture(t)
  app.jumpToPage(PAGE.Tools)
  app.state.selected = 1
  app.state.search = 'y'
  app.jumpToPage(PAGE.Tasks)
  app.restoreToolScope('global')
  assert.equal(app.state.page, PAGE.Tasks)
  assert.equal(app.pageState(PAGE.Tools).search, '')
  app.restoreToolScope('project')
  app.jumpToPage(PAGE.Tools)
  assert.equal(app.state.search, 'y')
  assert.equal(app.visibleItems()[app.state.selected].name, 'ruby')
})

test('a hidden log selection follows its entry when new commands finish', (t) => {
  const { app } = fixture(t)
  const original = { command: 'mise doctor', output: 'original output', success: true }
  app.state.logs = [original]
  app.jumpToPage(PAGE.Logs)
  app.state.detailScroll = 4
  app.jumpToPage(PAGE.Tasks)
  app.state.logs.unshift({ command: 'mise env', output: 'new output', success: true })
  app.jumpToPage(PAGE.Logs)
  assert.equal(app.visibleItems()[app.state.selected], original)
  assert.equal(app.state.selected, 1)
  assert.equal(app.state.detailScroll, 4)
})

test('search owns printable shortcuts and cancel restores the original viewport', (t) => {
  const { app, exits } = fixture(t)
  app.jumpToPage(PAGE.Tools)
  Object.assign(app.state, { selected: 1, detailScroll: 6, listStart: 1 })
  press(app, '/')
  for (const key of 'jq?1234:[]')
    press(app, key)
  assert.equal(app.state.overlay.type, 'Search')
  assert.equal(app.state.search, 'jq?1234:[]')
  assert.equal(app.state.focus, FOCUS.Group1)
  assert.equal(exits(), 0)
  press(app, 'escape')
  assert.equal(app.state.overlay, null)
  assert.equal(app.state.search, '')
  assert.equal(app.state.selected, 1)
  assert.equal(app.state.detailScroll, 6)
  assert.equal(app.state.listStart, 1)
})

test('help remembers category scroll and restores focus without selecting another target', (t) => {
  const { app } = fixture(t)
  app.jumpToPage(PAGE.Tools)
  press(app, '2')
  press(app, '?')
  press(app, 'down')
  press(app, 'down')
  press(app, 'right')
  assert.equal(app.state.overlay.category, 1)
  assert.equal(app.state.overlay.scroll, 0)
  press(app, 'down')
  press(app, '[')
  assert.equal(app.state.overlay.category, 0)
  assert.equal(app.state.overlay.scroll, 2)
  press(app, 'return')
  assert.equal(app.state.overlay, null)
  assert.equal(app.state.focus, FOCUS.Group2)
  assert.equal(app.state.page, PAGE.Tools)
})

test('destructive confirmation starts on cancel and requires an explicit affirmative choice', (t) => {
  const { app } = fixture(t)
  let deletes = 0
  confirmDelete(app, 'node@1', () => deletes++)
  press(app, 'enter')
  assert.equal(deletes, 0)
  assert.equal(app.state.overlay, null)
  confirmDelete(app, 'node@1', () => deletes++)
  press(app, 'right')
  press(app, 'enter')
  assert.equal(deletes, 1)
  confirmDelete(app, 'node@1', () => deletes++)
  press(app, 'y')
  assert.equal(deletes, 2)
})
