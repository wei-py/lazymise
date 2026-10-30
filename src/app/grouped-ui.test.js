import { afterEach, test } from 'bun:test'
import assert from 'node:assert/strict'
import { Application } from './controller.js'
import { confirmDelete } from './overlays.js'
import { FOCUS, GROUPS, PAGE, PAGE_ORDER } from './state.js'
import { pageActionsHint } from './view/hints.js'

let application
afterEach(async () => {
  await application?.close()
  application = null
})

function fixture() {
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
  application = app
  return { app, exits: () => exits }
}

function press(app, name, modifiers = {}) {
  app.handleKey({ name, sequence: name.length === 1 ? name : '', ...modifiers })
}

test('module keys activate saved page tabs and restore each page viewport', () => {
  const { app } = fixture()
  app.jumpToPage(PAGE.Tools)
  Object.assign(app.state, { selected: 2, detailScroll: 7, listStart: 1 })
  app.jumpToPage(PAGE.Console)
  app.state.search = 'finished'
  app.jumpToPage(PAGE.Config)
  app.jumpToPage(PAGE.Logs)
  for (const [key, page, focus] of [
    ['1', PAGE.Tools, FOCUS.Group1],
    ['2', PAGE.Console, FOCUS.Group2],
    ['3', PAGE.Config, FOCUS.Group3],
    ['4', PAGE.Logs, FOCUS.Group4],
  ]) {
    press(app, key)
    assert.equal(app.state.page, page)
    assert.equal(app.state.focus, focus)
  }
  press(app, '1')
  assert.equal(app.state.selected, 2)
  assert.equal(app.state.detailScroll, 7)
  assert.equal(app.state.listStart, 1)
  press(app, '2')
  assert.equal(app.state.search, 'finished')
})

test('Tab cycles navigation, the active list and details without visiting dormant modules', () => {
  const { app } = fixture()
  for (const [index, group] of GROUPS.entries()) {
    app.focusGroup(index)
    const page = app.state.page
    for (const focus of [FOCUS.Details, FOCUS.Navigation, group.id]) {
      press(app, 'tab')
      assert.equal(app.state.focus, focus)
      assert.equal(app.state.page, page)
      assert.equal(app.state.focusedGroup, index)
    }
    for (const focus of [FOCUS.Navigation, FOCUS.Details, group.id]) {
      press(app, 'backtab')
      assert.equal(app.state.focus, focus)
      assert.equal(app.state.page, page)
    }
    press(app, 'tab', { shift: true })
    assert.equal(app.state.focus, FOCUS.Navigation)
  }
})

test('horizontal navigation activates module pages while j and Enter restore saved list rows', () => {
  const { app } = fixture()
  app.jumpToPage(PAGE.Tasks)
  app.state.selected = 1
  app.jumpToPage(PAGE.Tools)
  app.state.selected = 2
  press(app, 'backtab')
  assert.equal(app.state.focus, FOCUS.Navigation)
  press(app, 'right')
  assert.equal(app.state.focus, FOCUS.Navigation)
  assert.equal(app.state.page, PAGE.Tasks)
  assert.equal(app.state.selected, 1)
  press(app, 'j')
  assert.equal(app.state.focus, FOCUS.Group2)
  assert.equal(app.state.selected, 1)
  press(app, 'k')
  assert.equal(app.state.selected, 0)
  assert.equal(app.state.focus, FOCUS.Group2)
  press(app, 'up')
  assert.equal(app.state.focus, FOCUS.Navigation)
  press(app, 'left')
  assert.equal(app.state.page, PAGE.Tools)
  assert.equal(app.state.selected, 2)
  press(app, 'enter')
  assert.equal(app.state.focus, FOCUS.Group1)
  assert.equal(app.state.selected, 2)
  press(app, 'l')
  assert.equal(app.state.focus, FOCUS.Details)
  press(app, 'j')
  assert.equal(app.state.detailScroll, 1)
  press(app, 'enter')
  assert.equal(app.state.focus, FOCUS.Details)
  press(app, 'h')
  assert.equal(app.state.focus, FOCUS.Group1)
  assert.equal(app.state.selected, 2)
  press(app, 'h')
  assert.equal(app.state.focus, FOCUS.Group1)
})

test('navigation wraps module switches, keeps subtabs, and ignores list actions and scrolling', () => {
  const { app } = fixture()
  app.jumpToPage(PAGE.Updates)
  press(app, 'k')
  assert.equal(app.state.focus, FOCUS.Navigation)
  press(app, 'h')
  assert.equal(app.state.page, PAGE.Dashboard)
  press(app, 'l')
  assert.equal(app.state.page, PAGE.Updates)
  press(app, ']')
  assert.equal(app.state.page, PAGE.Tools)
  assert.equal(app.state.focus, FOCUS.Navigation)
  press(app, '[')
  assert.equal(app.state.page, PAGE.Updates)
  for (const page of PAGE_ORDER) {
    app.jumpToPage(page, FOCUS.Navigation)
    const scope = app.state.toolScope
    for (const key of ['/', 'a', 'A', 'f2', 'm', 'M', 'i', 'I', 'D', 'space', 'u', 'U', 'R', 'n', 's', 'v', 'e', 'y', 'g', 'G', 'up', 'pageup', 'pagedown']) {
      press(app, key)
      assert.equal(app.state.focus, FOCUS.Navigation)
      assert.equal(app.state.page, page)
      assert.equal(app.state.overlay, null)
      assert.equal(app.state.toolScope, scope)
      assert.equal(app.state.toolViewInstalled, false)
      assert.equal(app.state.selectedUpdates.size, 0)
      assert.equal(app.state.selected, 0)
      assert.equal(app.state.detailScroll, 0)
    }
  }
})

test('footer controls follow navigation, list, details and overlay input focus in both languages', () => {
  const { app } = fixture()
  for (const language of ['en', 'zh']) {
    app.state.language = language
    app.jumpToPage(PAGE.Tools)
    const keys = () => pageActionsHint(app.state).map(chip => chip.key)
    assert.ok(keys().includes('i/I'))
    assert.ok(keys().includes('k'))
    press(app, 'k')
    assert.ok(keys().includes('h/l'))
    assert.ok(keys().includes('j/Enter'))
    assert.ok(!keys().includes('i/I'))
    press(app, 'j')
    press(app, 'l')
    assert.ok(keys().includes('j/k'))
    assert.ok(!keys().includes('i/I'))
    press(app, 'h')
    press(app, '/')
    assert.ok(keys().includes('Ctrl+u'))
    assert.ok(!keys().includes('i/I'))
    assert.ok(!keys().includes('h/l'))
    press(app, 'escape')
  }
})

test('paging uses the detail viewport rather than the left group row count', () => {
  const { app } = fixture()
  app.jumpToPage(PAGE.Tools)
  app.state.detailScroll = 5
  press(app, '0')
  press(app, 'pagedown')
  assert.equal(app.state.detailScroll, 15)
  press(app, 'pageup')
  assert.equal(app.state.detailScroll, 5)
})

test('list movement and paging stop at the first and last row', () => {
  const { app } = fixture()
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
  assert.equal(app.state.focus, FOCUS.Navigation)
})

test('all nine pages are reachable through four real group tabs', () => {
  const { app } = fixture()
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

test('page changes restore independent filters, rows and detail scroll', () => {
  const { app } = fixture()
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

test('scope switches preserve a hidden Tools page independently of the active page', () => {
  const { app } = fixture()
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

test('a hidden log selection follows its entry when new commands finish', () => {
  const { app } = fixture()
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

test('search owns printable shortcuts and cancel restores the original viewport', () => {
  const { app, exits } = fixture()
  app.jumpToPage(PAGE.Tools)
  Object.assign(app.state, { selected: 1, detailScroll: 6, listStart: 1 })
  press(app, '/')
  for (const key of 'hjklq/?1234:[]')
    press(app, key)
  assert.equal(app.state.overlay.type, 'Search')
  assert.equal(app.state.search, 'hjklq/?1234:[]')
  assert.equal(app.state.focus, FOCUS.Group1)
  assert.equal(exits(), 0)
  press(app, 'escape')
  assert.equal(app.state.overlay, null)
  assert.equal(app.state.search, '')
  assert.equal(app.state.selected, 1)
  assert.equal(app.state.detailScroll, 6)
  assert.equal(app.state.listStart, 1)
})

test('help remembers category scroll and restores focus without selecting another target', () => {
  const { app } = fixture()
  app.jumpToPage(PAGE.Tools)
  press(app, '2')
  press(app, 'k')
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
  assert.equal(app.state.focus, FOCUS.Navigation)
  assert.equal(app.state.page, PAGE.Tasks)
})

test('destructive confirmation starts on cancel and requires an explicit affirmative choice', () => {
  const { app } = fixture()
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

test('installed view retains independent identity and filters across pages and hidden target selection', () => {
  const { app } = fixture()
  const inactive = { name: 'node', version: '0', installed: true, active: false, source: null }
  app.state.snapshot.tools.push(inactive, { name: 'missing', version: '9', installed: false })
  app.jumpToPage(PAGE.Tools)
  Object.assign(app.state, { search: 'ruby', selected: 0, detailScroll: 4 })
  const target = { path: '/project/custom.toml', create: false }
  app.state.configTarget = target
  press(app, 'v')
  assert.equal(app.state.configTarget, target)
  assert.equal(app.state.toolScope, 'project')
  assert.equal(app.currentListLen(), 4)
  press(app, 'end')
  assert.equal(app.selectedTool(), inactive)
  app.state.search = '0'
  app.clampSelection()
  app.jumpToPage(PAGE.Tasks)
  assert.equal(app.pageState(PAGE.Tools).toolViewInstalled, true)
  assert.deepEqual(app.visibleItems(app.pageState(PAGE.Tools)), [inactive])
  app.jumpToPage(PAGE.Tools)
  assert.equal(app.selectedTool(), inactive)
  // Reordering the inventory must not change the remembered selected version.
  press(app, 'v')
  assert.equal(app.state.search, 'ruby')
  assert.equal(app.selectedTool().name, 'ruby')
  assert.equal(app.state.detailScroll, 4)
  app.state.snapshot.tools.reverse()
  press(app, 'v')
  assert.equal(app.selectedTool(), inactive)
  app.jumpToPage(PAGE.Config)
  app.setConfigTarget(target)
  assert.equal(app.state.toolViewInstalled, false)
  assert.equal(app.state.page, PAGE.Config)
  app.jumpToPage(PAGE.Tools)
  assert.equal(app.state.search, 'ruby')
  assert.equal(app.selectedTool().name, 'ruby')
})

test('quit keeps running and queued tasks alive until an explicit exit choice', async () => {
  for (const affirmative of [['y'], ['right', 'enter']]) {
    const { app, exits } = fixture()
    let started
    const ready = new Promise((resolve) => { started = resolve })
    let signal
    let queuedStarted = false
    const running = app.runner.submit({
      label: 'running fixture',
      serialized: true,
      run: async (api) => {
        signal = api.signal
        started()
        await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
      },
    })
    await ready
    const queued = app.runner.submit({
      label: 'queued fixture',
      serialized: true,
      run: async () => { queuedStarted = true },
    })
    try {
      for (const cancel of ['enter', 'escape', 'n', 'q']) {
        press(app, 'q')
        assert.equal(app.state.overlay.type, 'Quit')
        press(app, cancel)
        assert.equal(app.state.overlay, null)
        assert.equal(exits(), 0)
        assert.equal(signal.aborted, false)
        assert.deepEqual(app.state.jobs.map(job => job.state), ['running', 'queued'])
      }
      press(app, 'q')
      for (const key of affirmative) press(app, key)
      assert.equal(exits(), 1)
      await app.close()
      assert.equal(signal.aborted, true)
      assert.equal((await running).state, 'canceled')
      assert.equal((await queued).state, 'canceled')
      assert.equal(queuedStarted, false)
    }
    finally {
      await app.close()
    }
  }
})

test('quit exits directly when jobs have all settled', async () => {
  const { app, exits } = fixture()
  await app.runner.submit({ run: async () => {} })
  await app.runner.submit({ run: async () => { throw new Error('fixture failure') } })
  press(app, 'q')
  assert.equal(app.state.overlay, null)
  assert.equal(exits(), 1)
})
