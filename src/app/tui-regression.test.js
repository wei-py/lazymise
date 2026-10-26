import { Buffer } from 'node:buffer'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestRenderer } from '@opentui/core/testing'
import stringWidth from 'string-width'
import { expect, test } from '../../support/node-test.js'
import { t } from '../config/i18n.js'
import { loadSettings } from '../config/settings.js'
import { normalizeKey } from '../main.js'
import { runProcess } from '../process.js'
import { Application } from './controller.js'
import { openConfigTarget, openCustomTool, showHelp } from './overlays.js'
import { clipColumns, filterRegistryTools, GROUPS, PAGE_ORDER, VERSION_INTENT } from './state.js'
import { createView } from './view.js'
import { COLORS } from './view/colors.js'

async function fixture(run, width = 100, height = 24) {
  const previous = process.env.LAZYMISE_CONFIG_DIR
  const dir = mkdtempSync(join(tmpdir(), 'lazymise-regression-'))
  process.env.LAZYMISE_CONFIG_DIR = dir
  const ui = await createTestRenderer({
    width,
    height,
    kittyKeyboard: true,
    exitOnCtrlC: false,
    exitSignals: [],
  })
  const app = new Application(createView(ui.renderer), () => {
    throw new Error('Unexpected exit')
  })
  app.state.loading = false
  ui.renderer.keyInput.on('keypress', (key) => {
    if (key.eventType === 'release')
      return
    key.preventDefault()
    app.handleKey(normalizeKey(key))
  })
  const frame = async () => {
    app.update()
    await ui.renderOnce()
    return ui.captureCharFrame()
  }
  try {
    await run({ app, ui, frame, dir, path: join(dir, 'settings.json') })
  }
  finally {
    ui.renderer.destroy()
    if (previous === undefined)
      delete process.env.LAZYMISE_CONFIG_DIR
    else process.env.LAZYMISE_CONFIG_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

function colorChannels(color) {
  return color.slice(1).match(/../g).map(channel => Number.parseInt(channel, 16)).join(',')
}

function highlighted(ui, text) {
  return ui
    .captureSpans()
    .lines
    .some(line =>
      line.spans.some(
        span =>
          span.text.includes(text) && [...span.bg.buffer].slice(0, 3).join(',') === colorChannels(COLORS.selection),
      ),
    )
}

test('settings overlay cycles values, persists, and L toggles language', async () => {
  await fixture(async ({ app, ui, frame, path }) => {
    expect(app.state.language).toBe('en')
    expect(existsSync(path)).toBe(false)
    ui.mockInput.pressKey(':')
    expect(app.state.overlay.type).toBe('Settings')
    const opened = await frame()
    expect(opened).toContain('┌ Settings')
    expect(opened).toContain('Language: English')
    expect(highlighted(ui, 'Language: English')).toBe(true)
    ui.mockInput.pressEnter()
    expect(app.state.language).toBe('zh')
    expect(JSON.parse(readFileSync(path, 'utf8')).language).toBe('zh')
    expect(await frame()).toContain('语言: 中文')
    ui.mockInput.pressArrow('left')
    expect(app.state.language).toBe('en')
    ui.mockInput.pressArrow('right')
    expect(app.state.language).toBe('zh')
    ui.mockInput.pressKey('j')
    expect(app.state.overlay.cursor).toBe(1)
    const themeLabel = app.state.language === 'zh' ? '主题' : 'Theme'
    expect(await frame()).toContain(`${themeLabel}: ${app.state.theme}`)
    ui.mockInput.pressEnter()
    expect(app.state.theme).not.toBe('default')
    expect(JSON.parse(readFileSync(path, 'utf8')).theme).toBe(app.state.theme)
    ui.mockInput.pressEscape()
    expect(app.state.overlay).toBeNull()
    ui.mockInput.pressKey('l', { shift: true })
    expect(app.state.language).toBe('en')
    expect(JSON.parse(readFileSync(path, 'utf8')).language).toBe('en')
    expect(loadSettings().language).toBe('en')
  })
})

test('settings save failure preserves active language, then retries', async () => {
  await fixture(async ({ app, ui, frame, path }) => {
    mkdirSync(path)
    ui.mockInput.pressKey(':')
    ui.mockInput.pressEnter()
    expect(app.state.language).toBe('en')
    expect(app.state.status).toContain('EISDIR')
    expect(await frame()).toContain('Language: English')
    rmSync(path, { recursive: true })
    ui.mockInput.pressEnter()
    expect(app.state.language).toBe('zh')
    expect(await frame()).toContain('语言: 中文')
    expect(loadSettings().language).toBe('zh')
  })
})

test('column clipping preserves complete graphemes within every budget', () => {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
  for (const value of ['中文标题混合English', 'e\u0301e\u0301中文', '👩‍💻🙂中文', '界'.repeat(100)]) {
    for (let width = 0; width <= 30; width++) {
      const clipped = clipColumns(value, width)
      expect(stringWidth(clipped)).toBeLessThanOrEqual(width)
      const prefix = clipped.endsWith('…') ? clipped.slice(0, -1) : clipped
      const prefixes = ['']
      for (const { segment } of segmenter.segment(value)) prefixes.push(prefixes.at(-1) + segment)
      expect(prefixes).toContain(prefix)
    }
  }
})

function cells(row) {
  const result = []
  for (const { segment } of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(row)) {
    result.push(segment)
    for (let column = 1; column < stringWidth(segment); column++) result.push('')
  }
  return result
}

function modalRect(ui, title) {
  const rows = ui.captureCharFrame().split('\n')
  const top = rows.findIndex(row => row.includes(`┌ ${title}`))
  expect(top).toBeGreaterThanOrEqual(0)
  const left = stringWidth(
    rows[top].slice(0, rows[top].indexOf('┌', rows[top].indexOf(title) - 2)),
  )
  const bottom = rows.findIndex((row, index) => index > top && cells(row)[left] === '└')
  expect(bottom).toBeGreaterThan(top)
  // The ASCII bottom edge avoids continuation padding in captured CJK titles.
  const right = cells(rows[bottom]).indexOf('┘', left + 1)
  expect(left).toBeGreaterThanOrEqual(0)
  expect(right).toBeGreaterThan(left)
  expect(right).toBeLessThan(ui.renderer.width)
  expect(bottom).toBeLessThan(ui.renderer.height)
  for (let y = top + 1; y < bottom; y++) {
    expect(cells(rows[y])[left]).toBe('│')
    expect(cells(rows[y])[right]).toBe('│')
    let x = 0
    for (const span of ui.captureSpans().lines[y].spans) {
      const end = x + span.width
      if (end > left && x <= right) {
        const bg = [...span.bg.buffer].slice(0, 3).join(',')
        expect([colorChannels(COLORS.surface), colorChannels(COLORS.selection)]).toContain(bg)
        if (bg === colorChannels(COLORS.selection)) {
          expect(x).toBeGreaterThan(left)
          expect(end).toBeLessThanOrEqual(right)
        }
      }
      x = end
    }
  }
  return { left, right, top, bottom }
}

test('native modal borders center short content and hide the underlying panels', async () => {
  for (const [width, height] of [
    [100, 24],
    [70, 18],
  ]) {
    await fixture(
      async ({ app, ui, frame }) => {
        for (const language of ['en', 'zh']) {
          app.state.language = language
          app.state.overlay = { type: 'Search' }
          app.state.search = '中文e\u0301👩‍💻'
          await frame()
          const rect = modalRect(ui, language === 'en' ? 'Search' : '搜索')
          const spans = ui.captureSpans().lines[rect.top + 2].spans
          expect(spans.map(span => span.text).join('')).toContain('中文e\u0301👩‍💻')
        }
      },
      width,
      height,
    )
  }
})

const tools = Array.from({ length: 35 }, (_, index) => ({
  name: `tool-${index}`,
  description: `描述 e\u0301 👩‍💻 ${'长说明'.repeat(30)}`,
  backends: index % 2 ? ['npm', 'cargo'] : ['asdf', 'core'],
}))
const versions = Array.from({ length: 35 }, (_, index) => ({
  version: `v${index}`,
  created_at: '2026-01-01',
}))

test('all modal surfaces have closed bounded frames and visible selections in EN/ZH', async () => {
  for (const [width, height] of [
    [100, 24],
    [70, 18],
  ]) {
    await fixture(
      async ({ app, ui, frame }) => {
        for (const language of ['en', 'zh']) {
          app.state.language = language
          const overlays = [
            [{ type: 'Help', category: 0, scroll: 0, scrolls: [0, 0, 0] }, 'help_title'],
            [{ type: 'Search' }, 'search_title'],
            [{ type: 'CommandPalette', commands: tools, selected: 34 }, 'command_palette'],
            [
              {
                type: 'CommandBuilder',
                command: { name: 'install' },
                args: '',
                help: 'First\n\nLast',
                mode: 'help',
                scroll: 2,
              },
              null,
            ],
            [{ type: 'CustomTool', input: 'npm:工具' }, 'custom_tool'],
            [{ type: 'ConfirmDelete', message: '删除工具？' }, 'confirm_delete_title'],
            [{ type: 'ConfirmCommand', message: '运行命令？' }, 'confirm_command_title'],
            [
              { type: 'Picker', level: 'registry', tools, backends: ['All'], selected: 34 },
              'picker_registry',
            ],
            [
              { type: 'Picker', level: 'backends', backendList: ['npm', 'cargo'], selected: 1 },
              'picker_backends',
            ],
            [{ type: 'Picker', level: 'versions', versions, selected: 34 }, 'picker_versions'],
          ]
          for (const [overlay, titleKey] of overlays) {
            app.state.overlay = overlay
            await frame()
            modalRect(ui, titleKey ? t(language, titleKey) : 'mise install')
            if (overlay.type === 'CommandPalette' || overlay.level === 'registry')
              expect(highlighted(ui, 'tool-34')).toBe(true)
            if (overlay.level === 'backends')
              expect(highlighted(ui, 'cargo')).toBe(true)
            if (overlay.level === 'versions')
              expect(highlighted(ui, 'v34')).toBe(true)
            app.state.overlay = null
            const closed = await frame()
            expect(closed).not.toContain(`┌ ${titleKey ? t(language, titleKey) : 'mise install'}`)
          }
        }
      },
      width,
      height,
    )
  }
})

test('filtered registry selection enters and returns to the same backend tool', async () => {
  await fixture(async ({ app, ui, frame }) => {
    app.state.overlay = {
      type: 'Picker',
      level: 'registry',
      tools,
      backends: ['All', 'npm'],
      filterIdx: 1,
      search: 'tool-',
      selected: 0,
    }
    expect(await frame()).not.toContain('tool-0 ')
    expect(highlighted(ui, 'tool-1')).toBe(true)
    expect(highlighted(ui, '[npm]')).toBe(false)
    ui.mockInput.pressEnter()
    expect(app.state.overlay.level).toBe('backends')
    ui.mockInput.pressArrow('down')
    await frame()
    expect(highlighted(ui, 'cargo')).toBe(true)
    ui.mockInput.pressEscape()
    await frame()
    expect(highlighted(ui, 'tool-1')).toBe(true)
    expect(app.state.overlay.search).toBe('tool-')
    expect(app.state.overlay.filterIdx).toBe(1)
  })
})

test('registry filter matches full specs and offers direct specs outside the registry', () => {
  const tools = [
    { name: 'uapp', description: 'uni cli', backends: ['asdf'] },
    { name: 'eza', description: 'better ls', backends: ['npm', 'cargo'] },
  ]
  const names = overlay =>
    filterRegistryTools({ tools, backends: ['All', 'asdf', 'cargo'], filterIdx: 0, ...overlay }).map(
      item => item.name,
    )
  for (const [search, expected] of [
    ['', ['uapp', 'eza']],
    ['uapp', ['uapp']],
    ['npm:uapp', ['npm:uapp']],
    ['asdf:uapp', ['uapp']],
    ['npm:eza', ['eza']],
    ['npm:eza@1.2', ['npm:eza@1.2']],
    ['npm:@scope/pkg', ['npm:@scope/pkg']],
    ['npm:@scope/pkg@1.0.0', ['npm:@scope/pkg@1.0.0']],
    ['npm:', ['eza']],
    ['npm:u ap', []],
  ]) {
    expect(names({ search })).toEqual(expected)
  }
  for (const [search, pinned] of [
    ['npm:uapp', false],
    ['npm:uapp@3.2.1', true],
    ['npm:@scope/pkg', false],
    ['npm:@scope/pkg@1.0.0', true],
  ]) {
    expect(filterRegistryTools({ tools, backends: ['All'], filterIdx: 0, search })[0]).toMatchObject({
      name: search,
      direct: true,
      pinned,
    })
  }
  expect(names({ search: 'npm:zzz', filterIdx: 1 })).toEqual(['npm:zzz'])
})

test('registry search installs full specs missing from the mise registry', async () => {
  await isolated(
    `
    const config=dir+'/config.toml';writeFileSync(config,'[tools]\\n');
    app.state.configTarget={path:config,create:false};
    await openRegistry(app);
    await until(()=>!app.state.overlay.loading,'registry load');
    ui.mockInput.pressKey('/');type('zz');
    assert.ok((await frame()).includes(t('en','registry_no_match')));
    ui.mockInput.pressKey('u',{ctrl:true});type('npm:uapp');
    assert.ok((await frame()).includes(t('en','registry_direct_spec')));
    ui.mockInput.pressEnter();ui.mockInput.pressEnter();
    assert.equal(app.state.overlay.level,'versions');
    assert.equal(app.state.overlay.toolSpecName,'npm:uapp');
    await until(()=>!app.state.overlay.loading,'versions load');
    assert.ok((await frame()).includes('1.2.3'));
    ui.mockInput.pressEnter();
    await finished(1);
    await openRegistry(app);
    await until(()=>!app.state.overlay.loading,'registry reload');
    ui.mockInput.pressKey('/');type('npm:uapp@3.2.1');
    ui.mockInput.pressEnter();ui.mockInput.pressEnter();
    await finished(2);
    assert.deepEqual(argv(),[
      ['use','--yes','--path',config,'npm:uapp@1.2.3'],
      ['use','--yes','--path',config,'npm:uapp@3.2.1'],
    ]);
    assert.equal(app.state.overlay,null);
  `,
    recordedMise,
  )
})

test('empty, loading and failed pickers never highlight a fake item', async () => {
  await fixture(async ({ app, ui, frame }) => {
    for (const [level, key] of [
      ['registry', 'no_results'],
      ['backends', 'no_backends'],
      ['versions', 'no_versions'],
    ]) {
      for (const statusText of ['', 'Loading fixture', 'Original failure']) {
        app.state.overlay = { type: 'Picker', level, error: statusText, tools: [], selected: 0 }
        const text = statusText || t('en', key)
        expect(await frame()).toContain(text)
        expect(highlighted(ui, text)).toBe(false)
      }
    }
  })
})

test('Builder title, input tails and wrapped help retain visible selection', async () => {
  await fixture(
    async ({ app, ui, frame }) => {
      const input = `${'长参数'.repeat(60)}e\u0301👩‍💻END`
      for (const type of ['Search', 'CustomTool', 'CommandBuilder']) {
        app.state.search = input
        app.state.overlay = {
          type,
          command: { name: 'install' },
          input,
          args: input,
          help: `${'FIRST\n\n中文'.repeat(25)}\nLAST`,
          mode: 'input',
          scroll: 0,
        }
        const rendered = await frame()
        expect(rendered).toContain('e\u0301👩‍💻END█')
        expect(rendered).not.toContain('[object Object]')
        expect(app.state.overlay.args).toBe(input)
        if (type === 'CommandBuilder') {
          ui.mockInput.pressTab()
          await frame()
          expect(highlighted(ui, 'FIRST')).toBe(true)
          ui.mockInput.pressKey('END')
          await frame()
          expect(highlighted(ui, 'LAST')).toBe(true)
          ui.mockInput.pressEscape()
          expect(app.state.overlay.mode).toBe('input')
          expect(app.state.overlay.args).toBe(input)
          ui.mockInput.pressEscape()
          expect(await frame()).not.toContain('┌ mise install')
        }
      }
      app.state.overlay = {
        type: 'CommandBuilder',
        command: { name: '中文标题'.repeat(60) },
        args: '',
        help: '',
        mode: 'input',
      }
      expect(await frame()).toContain('…')
      modalRect(ui, 'mise 中文')
    },
    70,
    18,
  )
})

test('Help categories remember scrolling without leaking keys or changing the active target', async () => {
  await fixture(async ({ app, ui, frame }) => {
    app.jumpToPage('Tools')
    ui.mockInput.pressKey('2')
    showHelp(app)
    await frame()
    ui.mockInput.pressKey('o')
    expect(app.state.page).toBe('Tools')
    ui.mockInput.pressKey('j')
    expect(app.state.overlay.scroll).toBe(1)
    ui.mockInput.pressArrow('right')
    expect(app.state.overlay.category).toBe(1)
    expect(app.state.overlay.scroll).toBe(0)
    ui.mockInput.pressKey('j')
    ui.mockInput.pressKey('j')
    ui.mockInput.pressKey(']')
    expect(app.state.overlay.category).toBe(2)
    expect(app.state.overlay.scroll).toBe(0)
    ui.mockInput.pressKey('[')
    expect(app.state.overlay.scroll).toBe(2)
    ui.mockInput.pressArrow('left')
    expect(app.state.overlay.scroll).toBe(1)
    ui.mockInput.pressKey('HOME')
    expect(app.state.overlay.scroll).toBe(0)
    ui.mockInput.pressEnter()
    expect(app.state.overlay).toBeNull()
    expect(app.state.focus).toBe('Group2')
    expect(app.state.page).toBe('Tools')
    showHelp(app)
    ui.mockInput.pressKey('q')
    expect(app.state.overlay).toBeNull()
    showHelp(app)
    ui.mockInput.pressCtrlC()
    expect(app.state.overlay).toBeNull()
  }, 60, 8)
})

test('small sizes keep confirmations bounded and cancel-first', async () => {
  for (const [width, height] of [
    [60, 8],
    [59, 24],
    [100, 7],
  ]) {
    await fixture(
      async ({ app, ui, frame }) => {
        for (const language of ['en', 'zh']) {
          app.state.language = language
          for (const type of ['ConfirmDelete', 'ConfirmCommand']) {
            let executed = false
            app.state.overlay = {
              type,
              message: '中文混合 e\u0301👩‍💻 '.repeat(100),
              onConfirm: () => {
                executed = true
              },
            }
            const rendered = await frame()
            modalRect(
              ui,
              t(language, type === 'ConfirmDelete' ? 'confirm_delete_title' : 'confirm_command_title'),
            )
            expect(rendered).toContain(t(language, 'confirm_cancel'))
            expect(!!app.state.overlay.confirmSelected).toBe(false)
            ui.mockInput.pressKey('END')
            expect(await frame()).toContain(t(language, 'confirm_cancel'))
            expect(executed).toBe(false)
            ui.mockInput.pressEnter()
            expect(app.state.overlay).toBeNull()
            expect(executed).toBe(false)
          }
        }
      },
      width,
      height,
    )
  }
})

test('detail focus rejects list actions and explicit search owns text', async () => {
  await fixture(async ({ app, ui }) => {
    app.jumpToPage('Config')
    ui.mockInput.pressKey('0')
    ui.mockInput.pressKey('y')
    expect(app.state.overlay).toBeNull()
    app.jumpToPage('Config')
    expect(app.state.focus).toBe('Group3')
    ui.mockInput.pressKey('y')
    expect(app.state.status).toBe(t('en', 'no_config_selected'))
    expect(app.state.overlay).toBeNull()
    ui.mockInput.pressKey('z')
    expect(app.state.search).toBe('')
    ui.mockInput.pressKey('u', { ctrl: true })
    expect(app.state.page).toBe('Config')
    ui.mockInput.pressKey('/')
    ui.mockInput.pressKey('z')
    expect(app.state.search).toBe('z')
  })
})

async function isolated(run, setup = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lazymise-process-'))
  try {
    const executable = (name, body) => {
      const path = join(dir, name)
      writeFileSync(path, `#!${process.execPath}\n${body}`)
      chmodSync(path, 0o755)
    }
    executable(
      'mise',
      `const args=process.argv.slice(2);console.log(args[0]==='config' || args[0]==='registry' || args[0]==='ls-remote' ? '[]' : '{}')`,
    )
    setup({ dir, executable })
    const script = `
      import { createTestRenderer } from '@opentui/core/testing';
      import { Application } from './src/app/controller.js';
      import { createView } from './src/app/view.js';
      import { normalizeKey } from './src/main.js';
      import { loadSnapshot, validateConfigTarget } from './src/mise.js';
      import { filterRegistryTools, VERSION_INTENT } from './src/app/state.js';
      import { executeBackground, executeCommand } from './src/app/execution.js';
      import { openCommandPalette, openConfigTarget, openContextCommands, openCustomTool, openRegistry, openVersionsForAction, runPageCommand, selectConfigTarget, useTool } from './src/app/overlays.js';
      import { t } from './src/config/i18n.js';
      import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, symlinkSync, watch } from 'node:fs';
      import { resolve } from 'node:path';
      import { homedir } from 'node:os';
      import { createServer } from 'node:net';
      import assert from 'node:assert/strict';
      const dir = ${JSON.stringify(dir)};
      process.chdir(dir);
      const ui = await createTestRenderer({width:100,height:24,kittyKeyboard:true,exitOnCtrlC:false,exitSignals:[]});
      const app = new Application(createView(ui.renderer), () => { throw Error('Unexpected exit') });
      app.state.loading = false;
      ui.renderer.keyInput.on('keypress', key => {
        if(key.eventType !== 'release') { key.preventDefault(); app.handleKey(normalizeKey(key)); }
      });
      async function until(check, label='condition') {
        const deadline=Date.now()+5000;
        while(!check()) {
          if(Date.now()>deadline) throw Error('Timed out: '+label);
          await new Promise(resolve=>setImmediate(resolve));
        }
      }
      const pendingRefreshes=new Set(), refresh=app.refresh.bind(app);
      app.refresh=(...args)=>{
        const pending=refresh(...args);
        pendingRefreshes.add(pending);
        void pending.finally(()=>pendingRefreshes.delete(pending));
        return pending;
      };
      const finished = async count => {
        await until(()=>app.state.logs.length>=count && app.state.jobs.every(job=>!['queued','running'].includes(job.state)), 'background completion');
        await Promise.all([...pendingRefreshes]);
      };
      const argv = () => existsSync(dir+'/args') ? readFileSync(dir+'/args','utf8').trim().split('\\n').filter(Boolean).map(JSON.parse) : [];
      const frame = async () => { app.update();await ui.renderOnce();return ui.captureCharFrame(); };
      const type = value => { for(const char of value)ui.mockInput.pressKey(char); };
      async function inputTarget(path) {
        openConfigTarget(app);
        ui.mockInput.pressKey('END');ui.mockInput.pressEnter();
        type(path);ui.mockInput.pressEnter();
      }
      try { ${run} } finally { ui.renderer.destroy(); }
    `
    const { stdout, stderr, exitCode: code } = await runProcess(process.execPath, [
      '--experimental-ffi',
      '--no-warnings',
      '--input-type=module',
      '--eval',
      script,
    ], {
      env: {
        ...process.env,
        PATH: dir,
        HOME: dir,
        USERPROFILE: dir,
        XDG_CONFIG_HOME: undefined,
        MISE_GLOBAL_CONFIG_FILE: undefined,
        MISE_CONFIG_DIR: undefined,
        LAZYMISE_CONFIG_DIR: dir,
      },
    })
    expect({ code, stderr: code ? stderr : '', stdout: code ? stdout : '' }).toEqual({
      code: 0,
      stderr: '',
      stdout: '',
    })
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('config copy preserves content and reports isolated clipboard failures', async () => {
  for (const mode of ['ok', 'unsupported', 'missing-file', 'failure', 'missing-command']) {
    await isolated(
      `
      const path = dir + ${JSON.stringify(mode === 'unsupported' ? '/.tool-versions' : '/mise.toml')};
      const content = '[tools]\\nnode = "22"\\n';
      if (${JSON.stringify(mode)} !== 'missing-file') writeFileSync(path, content);
      app.state.snapshot.configs = [{path, tools:[]}];
      app.jumpToPage('Config');
      for (const key of ['4','0']) {
        ui.mockInput.pressKey(key); ui.mockInput.pressKey('y');
        assert.equal(existsSync(dir + '/clipboard'), false);
        assert.equal(app.state.overlay, null);
      }
      app.jumpToPage('Config');
      ui.mockInput.pressKey('y');
      await finished(0);
      assert.equal(app.state.overlay, null);
      assert.equal(app.state.search, '');
      assert.equal(app.state.page, 'Config');
      const mode = ${JSON.stringify(mode)};
      if(mode === 'ok' || mode === 'unsupported') {
        assert.equal(readFileSync(dir+'/clipboard','utf8'), content);
        assert.equal(app.state.status, t('en','config_copied',{path}));
      } else assert.match(app.state.status, mode === 'failure' ? /clipboard fixture failure/ : mode === 'missing-command' ? /not found|ENOENT/ : /ENOENT/);
    `,
      ({ dir, executable }) => {
        if (mode !== 'missing-command') {
          executable(
            process.platform === 'darwin'
              ? 'pbcopy'
              : process.platform === 'linux'
                ? 'wl-copy'
                : 'clip',
            mode === 'failure'
              ? `console.error('clipboard fixture failure');process.exit(1)`
              : `process.stdin.pipe(require('node:fs').createWriteStream(${JSON.stringify(join(dir, 'clipboard'))}))`,
          )
        }
      },
    )
  }
})

test('shifted Kitty and raw keys preserve uppercase actions and text', async () => {
  await fixture(async ({ app, ui, dir }) => {
    app.jumpToPage('Tools')
    const path = join(dir, 'mise.toml')
    writeFileSync(path, '[tools]\n')
    app.state.configTarget = { path, create: false }
    ui.mockInput.pressKey('g', { shift: true })
    ui.mockInput.pressKey('p')
    ui.renderer.stdin.emit('data', Buffer.from('G'))
    expect(app.state.configTarget.path).toBe(path)
    expect(app.state.page).toBe('Tools')
    ui.mockInput.pressKey('a', { shift: true })
    expect(app.state.overlay.type).toBe('CustomTool')
    for (const key of ['g', 'a']) ui.mockInput.pressKey(key, { shift: true })
    ui.mockInput.pressKey('?')
    ui.mockInput.pressKey(':')
    expect(app.state.overlay.input).toBe('GA?:')
    ui.mockInput.pressKey('x', { ctrl: true })
    ui.mockInput.pressKey('x', { meta: true })
    expect(app.state.overlay.input).toBe('GA?:')
    app.state.overlay = null
    ui.mockInput.pressKey('/')
    ui.mockInput.pressKey('g', { shift: true })
    ui.mockInput.pressKey('a', { shift: true })
    expect(app.state.search).toBe('GA')
  })
})

test('tool object snapshots preserve versions and precise deletion with visible errors', async () => {
  await isolated(
    `
    await app.refresh();
    assert.equal(app.state.status, '');
    app.jumpToPage('Tools');
    assert.deepEqual(app.state.snapshot.tools.map(t => [t.name,t.version,t.requested,t.installed,t.active]), [
      ['cargo:工具','1','1',false,false],
      ['node','22.1.0','22.1.0',true,true],
      ['node','20','20',true,false],
    ]);
    assert.equal(app.currentListLen(),1);
    for(let i=0;i<app.currentListLen();i++) {
      app.state.selected=i;app.update();await ui.renderOnce();
      assert.ok(ui.captureCharFrame().includes(app.selectedTool().version));
    }
    let original = app.state.snapshot;
    const path=dir+'/target.toml';writeFileSync(path,'[tools]\\n');
    app.state.snapshot.configs=[{path,tools:[]}];
    app.jumpToPage('Config');ui.mockInput.pressKey('s');
    assert.equal(app.state.snapshot,original);
    app.jumpToPage('Tools');
    app.state.search='22.1.0';app.clampSelection();app.update();await ui.renderOnce();
    assert.equal(app.currentListLen(),1);
    assert.equal(app.selectedTool().version,'22.1.0');
    assert.ok(ui.captureCharFrame().includes('22.1.0'));
    ui.mockInput.pressKey('D');
    assert.equal(app.state.overlay.type,'ConfirmDelete');
    assert.equal(app.state.overlay.name,'node@22.1.0');
    ui.mockInput.pressKey('n');assert.equal(existsSync(dir+'/args'),false);
    ui.mockInput.pressKey('D');ui.mockInput.pressKey('y');
    await finished(1);original=app.state.snapshot;
    assert.deepEqual(JSON.parse(readFileSync(dir+'/args','utf8').trim()),['uninstall','--yes','node@22.1.0']);
    for(const [raw,reason] of [
      ['[]','object'],['broken','JSON'],['{"node":[{}]}','version'],
      ['{"node":[{"version":"1","active":1}]}','active'],
      ['{"node":[{"version":"1","requested_version":null}]}','requested_version'],
      ['{"node":[{"version":"1","source":{"path":1}}]}','source.path'],
      ['{"node":{}}','array'],['{"node":[null]}','record'],['FAIL','fixture process failure'],
    ]) {
      writeFileSync(dir+'/response',raw);await app.refresh();
      assert.equal(app.state.snapshot,original);
      assert.ok(app.state.status.includes('mise ls --json'));
      assert.ok(app.state.status.includes(reason),app.state.status);
    }
    writeFileSync(dir+'/response','{}');await app.refresh();
    assert.equal(app.state.snapshot.tools.length,0);
    assert.equal(app.state.status,'');
  `,
    ({ dir, executable }) => {
      writeFileSync(
        join(dir, 'response'),
        JSON.stringify({
          'node': [
            { version: '20', installed: true },
            { version: '22.1.0', installed: true, active: true, source: { path: join(dir, 'mise.toml') } },
          ],
          'cargo:工具': [{ version: '1', requested_version: '', source: null }],
        }),
      )
      executable(
        'mise',
        `
      import {readFileSync,appendFileSync} from 'node:fs';
      const dir=${JSON.stringify(dir)},args=process.argv.slice(2);
      if(args[0]==='ls'){
        const raw=readFileSync(dir+'/response','utf8');
        if(raw==='FAIL'){console.error('fixture process failure');process.exit(2)}
        console.log(raw);
      }else if(args[0]==='uninstall')appendFileSync(dir+'/args',JSON.stringify(args)+'\\n');
      else console.log(args[0]==='config' ? '[]' : '{}');
    `,
      )
    },
  )
})

test('overlay flow search owns letters and cancellation restores the prior query', async () => {
  await fixture(async ({ app, ui, dir }) => {
    const path = join(dir, 'mise.toml')
    writeFileSync(path, '[tools]\n')
    app.state.configTarget = { path, create: false }
    app.state.overlay = {
      type: 'Picker',
      level: 'registry',
      tools,
      backends: ['All'],
      filterIdx: 0,
      search: 'tool-',
      selected: 2,
    }
    const ov = app.state.overlay
    ui.mockInput.pressKey('/')
    ui.mockInput.pressKey('u', { ctrl: true })
    for (const key of ['p', 'G', 'j', 'k', 'q']) ui.mockInput.pressKey(key)
    expect(ov.search).toBe('pGjkq')
    ui.mockInput.pressEscape()
    expect(ov.search).toBe('tool-')
    expect(ov.selected).toBe(2)
    expect(app.state.overlay).toBe(ov)
    ui.mockInput.pressKey('/')
    ui.mockInput.pressKey('u', { ctrl: true })
    ui.mockInput.pressKey('q')
    ui.mockInput.pressEnter()
    expect(ov.search).toBe('q')
    expect(ov.searching).toBe(false)
    ui.mockInput.pressKey('g', { shift: true })
    expect(app.state.configTarget.path).toBe(path)
    ui.mockInput.pressEscape()
    expect(app.state.overlay).toBeNull()
  })
})

test('command target picker and custom tool preserve exact specs and explicit paths', async () => {
  await isolated(
    `
    const path=dir+'/config with spaces.toml', other=dir+'/other.toml';
    writeFileSync(path,'[tools]\\n');writeFileSync(other,'[tools]\\n');
    process.env.MISE_GLOBAL_CONFIG_FILE=other;
    for(const [index,intent] of [[0,VERSION_INTENT.Use],[1,VERSION_INTENT.Install]]) {
      app.state.configTarget={path,create:false};
      app.state.overlay={type:'Picker',level:'versions',intent,selected:0,parent:null,
        toolSpecName:'cargo:example',versions:[{version:'1.2.3'}]};
      ui.mockInput.pressEnter();
      app.state.configTarget={path:other,create:false};
      await finished(index+1);
    }
    app.state.configTarget={path,create:false};openCustomTool(app);
    type('cargo:pG@1.2.3');
    ui.mockInput.pressTab();assert.equal(app.state.configTarget.path,path);
    ui.mockInput.pressEnter();await finished(3);
    assert.deepEqual(argv(),[
      ['use','--yes','--path',path,'cargo:example@1.2.3'],
      ['install','--yes','cargo:example@1.2.3'],
      ['use','--yes','--path',path,'cargo:pG@1.2.3'],
    ]);
    assert.ok(app.state.logs.some(log=>log.command.includes(path)));
  `,
    recordedMise,
  )
})

test('config editor, control scrolling and uppercase navigation stay distinct', async () => {
  await isolated(
    `
    app.state.snapshot.configs=[{path:dir+'/mise.toml',tools:[]}];
    app.jumpToPage('Config');
    ui.mockInput.pressKey('e');
    assert.equal(app.state.overlay.type,'ConfirmCommand');
    ui.mockInput.pressKey('y');
    await new Promise((resolve,reject)=>{
      const deadline=Date.now()+5000;
      function check(){
        if(app.state.logs.length && app.state.snapshot.configs.length===0)return resolve();
        if(Date.now()>deadline)return reject(Error('edit timeout'));
        setImmediate(check);
      }check();
    });
    assert.deepEqual(JSON.parse(readFileSync(dir+'/args','utf8').trim()),['edit',dir+'/mise.toml']);
    ui.mockInput.pressKey('e',{shift:true});assert.equal(app.state.page,'Config');
    app.jumpToPage('Updates');
    app.state.snapshot.updates=[{name:'node',current:'20',latest:'22'}];
    ui.mockInput.pressKey('u',{shift:true});assert.equal(app.state.overlay.type,'ConfirmCommand');
    ui.mockInput.pressKey('n');
    app.jumpToPage('Tools');
    app.state.snapshot.projectTools=Array.from({length:12},(_,i)=>({name:'node',version:String(i)}));
    await frame();
    ui.mockInput.pressKey('d',{ctrl:true});assert.ok(app.state.selected>0);
    ui.mockInput.pressKey('u',{ctrl:true});assert.equal(app.state.selected,0);
    assert.equal(app.state.page,'Tools');assert.equal(app.state.overlay,null);
  `,
    ({ dir, executable }) => {
      executable(
        'mise',
        `import {appendFileSync} from 'node:fs';const args=process.argv.slice(2);if(args[0]==='edit')appendFileSync(${JSON.stringify(join(dir, 'args'))},JSON.stringify(args)+'\\n');else console.log(args[0]==='config' ? '[]' : '{}')`,
      )
    },
  )
})

test('all text overlays accept shifted punctuation without command modifiers', async () => {
  await fixture(async ({ app, ui }) => {
    for (const [overlay, field] of [
      [
        { type: 'CommandPalette', commands: [], searching: true, search: '', selected: 0 },
        'search',
      ],
      [{ type: 'CommandBuilder', mode: 'input', args: '' }, 'args'],
      [{ type: 'Picker', level: 'registry', searching: true, search: '', selected: 0 }, 'search'],
    ]) {
      app.state.overlay = overlay
      ui.mockInput.pressKey('g', { shift: true })
      ui.mockInput.pressKey('a', { shift: true })
      ui.mockInput.pressKey('?')
      ui.mockInput.pressKey(':')
      ui.mockInput.pressKey('x', { ctrl: true })
      ui.mockInput.pressKey('x', { meta: true })
      expect(overlay[field]).toBe('GA?:')
    }
  })
})

function recordedMise({ dir, executable }) {
  executable(
    'mise',
    `
    import {appendFileSync,existsSync,writeFileSync} from 'node:fs';
    const args=process.argv.slice(2),dir=${JSON.stringify(dir)};
    if(args.includes('--help') || args.includes('-h')) console.log('fixture help');
    else if(['use','install','uninstall','upgrade','run'].includes(args[0])) {
      appendFileSync(dir+'/args',JSON.stringify(args)+'\\n');
      if(args[0]==='use' && args.includes('--path')) {
        const path=args[args.indexOf('--path')+1];
        if(!existsSync(path))writeFileSync(path,'[tools]\\n');
      }
    } else if(args[0]==='registry') console.log(JSON.stringify([{short:'example',backends:['cargo']}]));
    else if(args[0]==='ls-remote') console.log(JSON.stringify([{version:'1.2.3'}]));
    else console.log(args[0]==='config' ? '[]' : '{}');
  `,
  )
}

test('config target discovery rejects malformed records without discarding the snapshot or target', async () => {
  await isolated(
    `
    await app.refresh();assert.equal(app.state.status,'');
    assert.deepEqual(app.state.snapshot.configs.map(config=>config.path),[resolve('relative.toml'),dir+'/global.toml']);
    assert.deepEqual(app.state.snapshot.configs[0].tools,[]);
    app.state.configTarget={path:dir+'/global.toml',create:false};
    const original=app.state.snapshot,target=app.state.configTarget;
    for(const [raw,reason] of [
      ['broken','JSON'],['{}','array'],['[null]','[0]'],
      ['[{"path":""}]','path'],['[{"path":"ok.toml","tools":{}}]','tools'],
      ['[{"path":"ok.toml","tools":[2]}]','tools'],['FAIL','config fixture denied'],
    ]) {
      writeFileSync(dir+'/configs',raw);await app.refresh();
      assert.equal(app.state.snapshot,original);assert.equal(app.state.configTarget,target);
      assert.match(app.state.status,/mise config ls --json/);
      assert.ok(app.state.status.includes(reason),app.state.status);
    }
    openConfigTarget(app);writeFileSync(dir+'/configs','FAIL');
    ui.mockInput.pressKey('r');
    await until(()=>app.state.overlay.error.includes('config fixture denied'),'selector refresh failure');
    assert.equal(app.state.snapshot,original);assert.equal(app.state.configTarget,target);
    assert.ok((await frame()).includes('global.toml'));
    ui.mockInput.pressEscape();
    writeFileSync(dir+'/configs','[]');await app.refresh();
    assert.deepEqual(app.state.snapshot.configs,[]);
    assert.equal(app.state.configTarget,target);
    assert.equal(app.state.status,'');
  `,
    ({ dir, executable }) => {
      writeFileSync(join(dir, 'global.toml'), '[tools]\n')
      writeFileSync(
        join(dir, 'configs'),
        JSON.stringify([
          { path: 'relative.toml' },
          { path: join(dir, 'global.toml'), tools: ['node'] },
        ]),
      )
      executable(
        'mise',
        `
      import {readFileSync} from 'node:fs';
      if(process.argv[2]==='config'){
        const raw=readFileSync(${JSON.stringify(join(dir, 'configs'))},'utf8');
        if(raw==='FAIL'){console.error('config fixture denied');process.exit(2)}
        console.log(raw);
      }else console.log('{}');
    `,
      )
    },
  )
})

test('Config creates a current-directory target only after confirmation and never overwrites', async () => {
  await isolated(`
    const path=resolve('mise.toml'),global=dir+'/global.toml';
    writeFileSync(global,'[tools]\\nnode = "22"\\n');
    app.state.configTarget={path:global,create:false};
    app.state.snapshot.configs=[{path:global,tools:['node']}];
    app.jumpToPage('Config');
    for(const key of ['4','0']) {
      ui.mockInput.pressKey(key);ui.mockInput.pressKey('n');
      assert.equal(app.state.overlay,null);assert.equal(existsSync(path),false);
    }
    app.jumpToPage('Config');
    ui.mockInput.pressKey('n');
    assert.equal(app.state.overlay.type,'ConfirmCommand');
    assert.ok(app.state.overlay.message.includes(path));
    assert.equal(existsSync(path),false);
    ui.mockInput.pressEscape();
    assert.equal(app.state.configTarget.path,global);assert.equal(existsSync(path),false);
    app.state.search='global';
    ui.mockInput.pressKey('n');ui.mockInput.pressKey('y');
    assert.deepEqual(app.state.configTarget,{path,create:false});
    assert.equal(readFileSync(path,'utf8').trim(),'[tools]');
    assert.equal(app.selectedConfig().path,path);assert.equal(app.state.search,'');
    writeFileSync(path,'[tools]\\npython = "3.13"\\n');
    ui.mockInput.pressKey('n');ui.mockInput.pressKey('y');
    assert.match(app.state.status,/EEXIST/);
    assert.equal(readFileSync(path,'utf8'),'[tools]\\npython = "3.13"\\n');
    assert.equal(app.state.snapshot.configs.filter(config=>config.path===path).length,1);
    rmSync(path);symlinkSync(global,path);
    ui.mockInput.pressKey('n');ui.mockInput.pressKey('y');
    assert.match(app.state.status,/EEXIST/);
    assert.equal(readFileSync(global,'utf8'),'[tools]\\nnode = "22"\\n');
    rmSync(path);mkdirSync(path);
    ui.mockInput.pressKey('n');ui.mockInput.pressKey('y');
    assert.match(app.state.status,/EEXIST/);
    assert.equal(app.state.configTarget.path,path);
  `)
})

test('config target F2 deduplicates files and Config Enter chooses without changing inventory', async () => {
  await isolated(
    `
    const project=dir+'/project.toml',global=dir+'/global config.toml',unsupported=dir+'/.tool-versions';
    for(const path of [project,global,unsupported])writeFileSync(path,'');
    app.state.snapshot.configs=[
      {path:project,tools:['node']},{path:global,tools:['python']},
      {path:project,tools:['node']},{path:unsupported,tools:[]},
    ];
    app.state.snapshot.tools=[{name:'node',version:'22'},{name:'python',version:'3'}];
    app.state.snapshot.projectTools=app.state.snapshot.tools;
    const inventory=app.state.snapshot.tools;
    assert.equal(app.state.configTarget,null);
    app.jumpToPage('Tools');
    ui.mockInput.pressKey('F2');ui.mockInput.pressKey('j');ui.mockInput.pressEnter();
    assert.equal(app.state.configTarget.path,global);
    assert.equal(app.state.snapshot.tools,inventory);assert.deepEqual(argv(),[]);
    ui.mockInput.pressKey('F2');
    assert.equal(app.state.overlay.selected,1);
    ui.mockInput.pressKey('j');ui.mockInput.pressEnter();
    assert.equal(app.state.overlay.type,'ConfigTarget');
    assert.equal(app.state.configTarget.path,global);
    assert.ok(app.state.overlay.error);
    ui.mockInput.pressKey('/');type('PROJECT');
    ui.mockInput.pressEnter();ui.mockInput.pressKey('HOME');ui.mockInput.pressEnter();
    assert.equal(app.state.configTarget.path,project);
    app.jumpToPage('Config');app.state.selected=1;ui.mockInput.pressKey('s');
    assert.equal(app.state.configTarget.path,global);assert.equal(app.state.page,'Config');
    assert.equal(app.state.snapshot.tools,inventory);assert.deepEqual(argv(),[]);
  `,
    recordedMise,
  )
})

test('config target path validation rejects invalid and vanished files while keeping pending input', async () => {
  await isolated(
    `
    const valid=dir+'/valid.toml';writeFileSync(valid,'');
    mkdirSync(dir+'/directory.toml');
    symlinkSync(dir+'/absent.toml',dir+'/dangling.toml');
    symlinkSync(valid,dir+'/linked.toml');
    writeFileSync(dir+'/rust-toolchain.toml','');
    writeFileSync(dir+'/plain.txt','');
    assert.deepEqual(validateConfigTarget(dir+'/linked.toml'),{path:dir+'/linked.toml',create:false});
    for(const path of [dir+'/directory.toml',dir+'/dangling.toml',dir+'/rust-toolchain.toml',dir+'/plain.txt',dir+'/missing-parent/new.toml']) {
      app.state.overlay=null;
      await inputTarget(path);
      assert.equal(app.state.configTarget,null);
      assert.equal(app.state.overlay.type,'ConfigTarget');
      assert.equal(app.state.overlay.input,path);assert.ok(app.state.overlay.error);
      assert.deepEqual(argv(),[]);
    }
    app.state.overlay=null;await inputTarget(valid);
    openCustomTool(app);type('cargo:example@1.2.3');
    rmSync(valid);ui.mockInput.pressEnter();
    assert.equal(app.state.overlay.type,'CustomTool');
    assert.equal(app.state.overlay.input,'cargo:example@1.2.3');
    assert.equal(app.state.configTarget.path,valid);assert.deepEqual(argv(),[]);
    ui.mockInput.pressKey('F2');ui.mockInput.pressEscape();
    assert.equal(app.state.overlay.input,'cargo:example@1.2.3');
  `,
    recordedMise,
  )
})

test('config target creation approval is write-free and consumed after actual creation', async () => {
  await isolated(
    `
    const path=dir+'/new config.toml';
    await inputTarget(path);
    assert.equal(app.state.overlay.type,'ConfirmCommand');
    assert.ok(app.state.overlay.message.includes(path));
    assert.equal(existsSync(path),false);
    ui.mockInput.pressKey('n');
    assert.equal(app.state.overlay.input,path);
    assert.equal(existsSync(path),false);assert.equal(app.state.configTarget,null);
    ui.mockInput.pressEnter();ui.mockInput.pressKey('y');
    assert.deepEqual(app.state.configTarget,{path,create:true});
    assert.equal(existsSync(path),false);assert.deepEqual(argv(),[]);
    openCustomTool(app);type('cargo:example@1.2.3');ui.mockInput.pressEnter();
    await finished(1);
    assert.equal(existsSync(path),true);assert.equal(app.state.configTarget.create,false);
    rmSync(path);openCustomTool(app);type('cargo:example@2');ui.mockInput.pressEnter();
    assert.equal(app.state.overlay.input,'cargo:example@2');
    assert.equal(argv().length,1);assert.equal(existsSync(path),false);
  `,
    recordedMise,
  )
})

test('config target absent target resumes only the captured requested flow and cancel does nothing', async () => {
  await isolated(
    `
    const path=dir+'/target.toml';writeFileSync(path,'');
    app.state.snapshot.configs=[{path,tools:[]}];
    app.state.snapshot.projectTools=[{name:'cargo:example',version:'1'},{name:'other',version:'2'}];
    app.jumpToPage('Tools');
    for(const key of ['a','A','I']) {
      ui.mockInput.pressKey(key);
      assert.equal(app.state.overlay.type,'ConfigTarget');
      ui.mockInput.pressEscape();assert.equal(app.state.overlay,null);
      assert.deepEqual(argv(),[]);
    }
    ui.mockInput.pressKey('I');
    assert.equal(app.state.overlay.type,'ConfigTarget');
    app.state.selected=1;
    ui.mockInput.pressEnter();
    await until(()=>app.state.overlay?.level==='versions' && !app.state.overlay.loading,'captured version flow');
    assert.equal(app.state.overlay.toolSpecName,'cargo:example');
    assert.deepEqual(argv(),[]);
    ui.mockInput.pressEscape();assert.equal(app.state.overlay,null);
    app.state.configTarget=null;
    ui.mockInput.pressKey('A');ui.mockInput.pressEnter();
    assert.equal(app.state.overlay.type,'CustomTool');assert.deepEqual(argv(),[]);
  `,
    recordedMise,
  )
})

test('group navigation preserves the right target and restores each page viewport', async () => {
  await fixture(async ({ app, ui }) => {
    app.state.snapshot.projectTools = [
      { name: 'node', version: '20' },
      { name: 'node', version: '22', source: `/project/${'nested-directory/'.repeat(80)}mise.toml` },
    ]
    app.jumpToPage('Tools')
    ui.mockInput.pressKey('j')
    app.state.search = 'node'
    app.state.detailScroll = 3
    for (const [digit, focus] of [
      ['1', 'Group1'],
      ['2', 'Group2'],
      ['3', 'Group3'],
      ['4', 'Group4'],
      ['0', 'Details'],
    ]) {
      ui.mockInput.pressKey(digit)
      expect(app.state.focus).toBe(focus)
      expect(app.state.page).toBe('Tools')
      expect(app.state.selected).toBe(1)
      expect(app.state.search).toBe('node')
      expect(app.state.detailScroll).toBe(3)
    }
    ui.mockInput.pressEscape()
    expect(app.state.focus).toBe('Group4')
    ui.mockInput.pressTab()
    expect(app.state.focus).toBe('Details')
    ui.mockInput.pressTab({ shift: true })
    expect(app.state.focus).toBe('Group4')
    expect(app.state.page).toBe('Tools')
    expect(app.state.selected).toBe(1)
    expect(app.state.search).toBe('node')
    expect(app.state.detailScroll).toBe(3)
    const visited = new Set()
    for (const [index, group] of GROUPS.entries()) {
      ui.mockInput.pressKey(String(index + 1))
      ui.mockInput.pressEnter()
      ui.mockInput.pressEscape()
      visited.add(app.state.page)
      for (let tab = 1; tab < group.pages.length; tab++) {
        ui.mockInput.pressKey(']')
        visited.add(app.state.page)
      }
      expect(app.state.groupTabs[index]).toBe(group.pages.at(-1))
    }
    expect([...visited].sort()).toEqual([...PAGE_ORDER].sort())
    app.jumpToPage('Tools')
    expect(app.state.selected).toBe(1)
    expect(app.state.search).toBe('node')
    expect(app.state.detailScroll).toBe(3)
    app.jumpToPage('Dashboard')
    for (const key of ['t', 'b', 'E', 'c', 's', 'o', 'p']) {
      ui.mockInput.pressKey(key)
      expect(app.state.page).toBe('Dashboard')
      expect(app.state.configTarget).toBeNull()
    }
  })
})

test('navigation details rejects list actions and visible predicates match rendered selection', async () => {
  await isolated(
    `
    const path=dir+'/target.toml';writeFileSync(path,'');
    app.state.snapshot.projectTools=[{name:'node',version:'20'},{name:'node',version:'22'}];
    app.state.snapshot.configs=[{path,tools:['special-tool']}];
    app.state.snapshot.tasks=[{name:'first',description:'other'},{name:'selected-task',description:'unique description'}];
    app.state.snapshot.updates=[{name:'node',current:'20',latest:'22'}];
    app.state.commands=[{name:'env',description:'unique environment'},{name:'doctor',description:'unique diagnosis'}];
    app.state.jobs.push({id:'new',kind:'mise',label:'new task',state:'done',startedAt:1,endedAt:2,exitCode:0,lastLine:'needle output'}, {id:'old',kind:'mise',label:'old task',state:'failed',startedAt:1,endedAt:2,exitCode:1,lastLine:'other output'});
    app.state.logs=[{command:'latest command',output:'latest output',success:true},{command:'older command',output:'older output',success:true}];
    for(const [page,query,selected] of [
      ['Tools','22','22'],['Config','special-tool','target.toml'],
      ['Tasks','unique description','selected-task'],['Environment','unique environment','env'],
      ['System','unique diagnosis','doctor'],['Console','needle output','new'],
      ['Logs','latest output','latest command'],
    ]) {
      app.jumpToPage(page);app.state.search=query;app.clampSelection();
      const rows=app.visibleItems();assert.equal(rows.length,1,page+' visible rows');
      assert.ok((await frame()).includes(selected),page+' rendered selection: '+selected);
      if(page==='Config') {
        assert.equal(app.selectedConfig().path,path,'Config selected entity');
        ui.mockInput.pressKey('s');assert.equal(app.state.configTarget.path,path);
      }
      else if(page==='Logs' || page==='Console') {
        ui.mockInput.pressEnter();assert.equal(app.state.focus,'Details');
        assert.ok((await frame()).includes(page==='Console'?rows[0].lastLine:rows[0].output));
      }
    }
    for(const page of ['Tools','Tasks','Updates','Config']) {
      app.jumpToPage(page);app.state.focus='Details';
      for(const key of ['I','i','D','d','e','y','u','U','s','R','a','A','F2','m','M','space'])ui.mockInput.pressKey(key);
      assert.equal(app.state.overlay,null);assert.deepEqual(argv(),[]);
    }
    app.jumpToPage('Dashboard');ui.mockInput.pressEnter();assert.deepEqual(argv(),[]);
  `,
    recordedMise,
  )
})

test('overlay flow page and palette searches restore cursors and delete entire graphemes', async () => {
  await fixture(async ({ app, ui }) => {
    app.jumpToPage('Tools')
    app.state.snapshot.projectTools = [
      { name: 'old-a', version: '1' },
      { name: 'old-b', version: '2' },
    ]
    app.state.search = 'old'
    app.state.selected = 1
    ui.mockInput.pressKey('/')
    ui.mockInput.pressKey('u', { ctrl: true })
    ui.mockInput.pressKey('n')
    ui.mockInput.pressEscape()
    expect(app.state.search).toBe('old')
    expect(app.state.selected).toBe(1)
    for (const [overlay, field] of [
      [{ type: 'Search', previousSearch: '', previousSelected: 0 }, null],
      [{ type: 'CustomTool', input: '' }, 'input'],
      [
        { type: 'CommandPalette', commands: [], searching: true, search: '', selected: 0 },
        'search',
      ],
      [{ type: 'CommandBuilder', command: { name: 'install' }, mode: 'input', args: '' }, 'args'],
      [
        { type: 'Picker', level: 'registry', tools: [], searching: true, search: '', selected: 0 },
        'search',
      ],
      [{ type: 'ConfigTarget', mode: 'path', input: '', search: '', selected: 0 }, 'input'],
    ]) {
      app.state.overlay = overlay
      if (field)
        overlay[field] = 'Ae\u0301👩‍💻'
      else app.state.search = 'Ae\u0301👩‍💻'
      ui.mockInput.pressKey('BACKSPACE')
      expect(field ? overlay[field] : app.state.search).toBe('Ae\u0301')
      ui.mockInput.pressKey('BACKSPACE')
      expect(field ? overlay[field] : app.state.search).toBe('A')
      ui.mockInput.pressKey('u', { ctrl: true })
      expect(field ? overlay[field] : app.state.search).toBe('')
      ui.mockInput.pressKey('q')
      expect(field ? overlay[field] : app.state.search).toBe('q')
      ui.mockInput.pressCtrlC()
      expect(app.state.overlay).toBeNull()
    }
  })
})

test('overlay flow direct versions and registry backend chains restore only their actual parents', async () => {
  await isolated(
    `
    const path=dir+'/target.toml';writeFileSync(path,'');app.state.configTarget={path,create:false};
    app.state.snapshot.projectTools=[{name:'cargo:example',version:'1'}];app.jumpToPage('Tools');
    await openVersionsForAction(app, VERSION_INTENT.Use);
    ui.mockInput.pressEscape();assert.equal(app.state.overlay,null);assert.equal(app.state.page,'Tools');
    await openRegistry(app);
    const root=app.state.overlay;
    root.tools=[{name:'multi',backends:['npm','cargo']},{name:'single',backends:['cargo']}];
    root.search='';root.selected=0;app.update();
    ui.mockInput.pressEnter();assert.equal(app.state.overlay.level,'backends');
    ui.mockInput.pressKey('j');ui.mockInput.pressEnter();
    await until(()=>app.state.overlay?.level==='versions' && !app.state.overlay.loading,'multi versions');
    assert.equal(app.state.overlay.toolSpecName,'cargo:multi');
    ui.mockInput.pressEscape();assert.equal(app.state.overlay.level,'backends');
    ui.mockInput.pressEscape();assert.equal(app.state.overlay,root);
    assert.equal(root.selected,0);
    ui.mockInput.pressKey('j');ui.mockInput.pressEnter();
    await until(()=>app.state.overlay?.level==='versions' && !app.state.overlay.loading,'single versions');
    assert.equal(app.state.overlay.toolSpecName,'cargo:single');
    ui.mockInput.pressEscape();assert.equal(app.state.overlay,root);assert.equal(root.selected,1);
    ui.mockInput.pressCtrlC();assert.equal(app.state.overlay,null);assert.deepEqual(argv(),[]);
  `,
    recordedMise,
  )
})

test('overlay flow late registry version and help responses cannot resurrect cancelled overlays', async () => {
  await isolated(
    `
    const path=dir+'/target.toml';writeFileSync(path,'');app.state.configTarget={path,create:false};
    app.state.snapshot.projectTools=[{name:'cargo:example',version:'1'}];app.jumpToPage('Tools');
    for(const kind of ['registry','ls-remote','help']) {
      if(kind==='help') {
        app.state.commands=[{name:'env',description:'Environment'}];app.jumpToPage('Environment');
      }
      const request=kind==='registry'?openRegistry(app):kind==='ls-remote'?openVersionsForAction(app, VERSION_INTENT.Use):runPageCommand(app);
      let replacement;
      try {
        await until(()=>existsSync(dir+'/'+kind+'.ready'),kind+' start');
        const loading=app.state.overlay;
        ui.mockInput.pressKey('F2');assert.equal(app.state.overlay,loading);
        ui.mockInput.pressEscape();assert.equal(app.state.overlay,null);
        openCustomTool(app);type('retained');
        replacement=app.state.overlay;
      } finally {
        writeFileSync(dir+'/'+kind+'.release','');
        await request;
      }
      assert.equal(app.state.overlay,replacement);assert.equal(replacement.input,'retained');
      ui.mockInput.pressCtrlC();
    }
  `,
    ({ dir, executable }) => {
      executable(
        'mise',
        `
      import {watch,existsSync,writeFileSync} from 'node:fs';
      const dir=${JSON.stringify(dir)},args=process.argv.slice(2),kind=args.includes('--help')||args.includes('-h')?'help':args[0];
      if(['registry','ls-remote','help'].includes(kind)){
        await new Promise(resolve=>{
          const observer=watch(dir,()=>{if(existsSync(dir+'/'+kind+'.release')){observer.close();resolve()}});
          writeFileSync(dir+'/'+kind+'.ready','');
        });
        console.log(kind==='registry'?'[{"short":"example","backends":["cargo"]}]':kind==='help'?'Fixture help':'[{"version":"1.2.3"}]');
      }else console.log(kind==='config'?'[]':'{}');
    `,
      )
    },
  )
})

test('overlay flow remote failures remain visible and retry in place for registry versions and help', async () => {
  await isolated(
    `
    const path=dir+'/target.toml';writeFileSync(path,'');app.state.configTarget={path,create:false};
    app.state.snapshot.projectTools=[{name:'cargo:example',version:'1'}];app.jumpToPage('Tools');
    for(const kind of ['registry','ls-remote','help']) {
      writeFileSync(dir+'/failure',kind);
      if(kind==='registry')await openRegistry(app);
      else if(kind==='ls-remote')await openVersionsForAction(app, VERSION_INTENT.Use);
      else {
        app.state.commands=[{name:'upgrade',description:'Upgrade'}];
        openCommandPalette(app);ui.mockInput.pressEnter();
        await until(()=>app.state.overlay?.type==='CommandBuilder' && !app.state.overlay.loading,'failed help');
      }
      assert.match(await frame(),/fixture denied/);
      const level=app.state.overlay.level;
      if(kind==='help')ui.mockInput.pressTab();
      writeFileSync(dir+'/failure','');
      ui.mockInput.pressKey('r');
      await until(()=>!app.state.overlay.loading && !(app.state.overlay.statusText||app.state.overlay.error||'').includes('fixture denied'),'retry '+kind);
      assert.equal(app.state.overlay.level,level);
      assert.doesNotMatch(await frame(),/fixture denied/);
      ui.mockInput.pressCtrlC();assert.equal(app.state.overlay,null);
    }
  `,
    ({ dir, executable }) => {
      writeFileSync(join(dir, 'failure'), '')
      executable(
        'mise',
        `
      import {readFileSync} from 'node:fs';
      const args=process.argv.slice(2),kind=args.includes('--help')||args.includes('-h')?'help':args[0];
      if(readFileSync(${JSON.stringify(join(dir, 'failure'))},'utf8')===kind){console.error('fixture denied '+kind);process.exit(2)}
      if(kind==='registry')console.log('[{"short":"example","backends":["cargo:example"]}]');
      else if(kind==='ls-remote')console.log('[{"version":"1.2.3"}]');
      else if(kind==='help')console.log('Recovered help');
      else console.log(kind==='config'?'[]':'{}');
    `,
      )
    },
  )
})

test('command target updates capture current marked and visible sets before confirmation', async () => {
  await isolated(
    `
    const updates=[{name:'alpha',current:'1',latest:'2'},{name:'beta',current:'1',latest:'2'},{name:'bravo',current:'1',latest:'2'}];
    for(const mode of ['current','marked','visible']) {
      app.state.snapshot.updates=updates;app.jumpToPage('Updates');
      app.state.search='';app.state.selected=1;app.state.selectedUpdates.clear();
      if(mode==='marked') {
        ui.mockInput.pressKey(' ');app.state.selected=0;ui.mockInput.pressKey(' ');
        app.state.search='bravo';app.clampSelection();
      }
      if(mode==='visible') {app.state.search='b';app.clampSelection()}
      const expected=mode==='current'?['beta']:mode==='marked'?['alpha','beta']:['beta','bravo'];
      if(mode==='visible')ui.mockInput.pressKey('U');else ui.mockInput.pressKey('u');
      assert.equal(app.state.overlay.type,'ConfirmCommand');
      for(const name of expected)assert.ok(app.state.overlay.message.includes(name));
      const before=argv().length;
      ui.mockInput.pressKey('n');assert.equal(argv().length,before);
      if(mode==='visible')ui.mockInput.pressKey('U');else ui.mockInput.pressKey('u');
      app.state.search='no matches';app.state.snapshot.updates=[];
      ui.mockInput.pressKey('y');await finished(before+1);
      assert.deepEqual(argv().at(-1),['upgrade','--yes',...expected]);
    }
    app.state.snapshot.updates=[];app.jumpToPage('Updates');
    ui.mockInput.pressKey('u');ui.mockInput.pressKey('U');
    assert.equal(app.state.overlay,null);assert.equal(argv().length,3);
  `,
    recordedMise,
  )
})

test('command target expert upgrade confirmation returns to the same builder and never injects a target', async () => {
  await isolated(
    `
    const path=dir+'/target.toml';writeFileSync(path,'');app.state.configTarget={path,create:false};
    app.state.commands=[{name:'upgrade',description:'Upgrade tools'},{name:'doctor',description:'Diagnose'}];
    openCommandPalette(app);ui.mockInput.pressKey('/');type('upgrade');ui.mockInput.pressEnter();
    const palette=app.state.overlay;
    ui.mockInput.pressEnter();
    await until(()=>app.state.overlay?.type==='CommandBuilder' && !app.state.overlay.loading,'builder help');
    type('cargo:example');
    const builder=app.state.overlay;
    ui.mockInput.pressTab();ui.mockInput.pressEscape();
    assert.equal(app.state.overlay,builder);assert.equal(builder.args,'cargo:example');
    ui.mockInput.pressEnter();assert.equal(app.state.overlay.type,'ConfirmCommand');
    assert.ok(app.state.overlay.message.includes('upgrade cargo:example'));
    assert.deepEqual(argv(),[]);ui.mockInput.pressKey('n');
    assert.equal(app.state.overlay,builder);assert.equal(builder.args,'cargo:example');
    ui.mockInput.pressEscape();assert.equal(app.state.overlay,palette);
    assert.equal(palette.search,'upgrade');
    ui.mockInput.pressEnter();
    await until(()=>app.state.overlay?.type==='CommandBuilder' && !app.state.overlay.loading,'reopened builder');
    type('cargo:example');ui.mockInput.pressEnter();ui.mockInput.pressKey('y');
    await finished(1);
    assert.deepEqual(argv(),[['upgrade','cargo:example']]);assert.equal(app.state.overlay,null);
  `,
    recordedMise,
  )
})

test('command target missing executable nonzero exit and completion callback failures stay observable', async () => {
  await isolated(
    `
    const task=await executeBackground(app, ['install','--yes','bad@1'],'failure');
    await finished(1);
    assert.equal(task.state,'failed');assert.match(task.lastLine,/fixture install failure/);
    assert.equal(app.state.logs[0].success,false);
    const callback=await executeBackground(app, ['install','--yes','ok@1'],'callback',()=>{throw Error('completion failure')});
    await finished(2);
    assert.equal(callback.state,'done');
    assert.equal(app.state.logs[0].success,false);assert.match(app.state.logs[0].output,/completion failure/);
    rmSync(dir+'/mise');
    const missing=await executeBackground(app, ['install','--yes','missing@1'],'missing');
    await finished(3);
    assert.equal(missing.state,'failed');assert.match(missing.lastLine,/mise|ENOENT|not found/i);
    assert.equal(app.state.logs[0].success,false);
    const snapshot=app.state.snapshot;
    executeCommand(app, ['edit',dir+'/target.toml'],true);
    assert.equal(app.state.overlay.type,'ConfirmCommand');
    ui.mockInput.pressKey('y');
    await finished(4);
    assert.equal(app.state.logs[0].success,false);assert.match(app.state.logs[0].output,/mise|ENOENT|not found/i);
    await executeCommand(app, ['doctor'],false);
    assert.equal(app.state.logs[0].success,false);assert.match(app.state.logs[0].output,/mise|ENOENT|not found/i);
    assert.equal(app.state.snapshot,snapshot);
  `,
    ({ executable }) => {
      executable(
        'mise',
        `
      const args=process.argv.slice(2);
      if(args.includes('bad@1')){console.error('fixture install failure');process.exit(7)}
      console.log(args[0]==='config'?'[]':'{}');
    `,
      )
    },
  )
})

test('command target closed output streams do not finish a task before process exit', async () => {
  await isolated(
    `
    const pending=executeBackground(app, ['install','--yes','slow@1'],'slow');
    try {
      await until(()=>existsSync(dir+'/closed'),'closed streams');
      assert.equal(app.state.jobs[0].state,'running');assert.equal(app.state.logs.length,0);
    } finally { writeFileSync(dir+'/release','') }
    const task=await pending;
    await finished(1);
    assert.equal(task.state,'failed');assert.equal(app.state.logs[0].success,false);
  `,
    ({ dir, executable }) => {
      executable(
        'mise',
        `
      import {closeSync,watch,existsSync,writeFileSync} from 'node:fs';
      const dir=${JSON.stringify(dir)};
      if(process.argv[2]==='install'){
        closeSync(1);closeSync(2);
        await new Promise(resolve=>{
          const observer=watch(dir,()=>{if(existsSync(dir+'/release')){observer.close();resolve()}});
          writeFileSync(dir+'/closed','');
        });
        process.exit(9);
      }else console.log(process.argv[2]==='config'?'[]':'{}');
    `,
      )
    },
  )
})

test('command target failed use consumes creation authorization only when a file was actually created', async () => {
  await isolated(
    `
    for(const name of ['missing','created']) {
      const path=dir+'/'+name+'.toml';app.state.configTarget={path,create:true};
      assert.equal(useTool(app, name+'@1'),true);
      await finished(name==='missing'?1:2);
      assert.equal(app.state.jobs.at(-1).state,'failed');
      assert.equal(app.state.configTarget.create,name==='missing');
      assert.equal(existsSync(path),name==='created');
    }
  `,
    ({ executable }) => {
      executable(
        'mise',
        `
      import {writeFileSync} from 'node:fs';
      const args=process.argv.slice(2);
      if(args.at(-1)==='created@1')writeFileSync(args[args.indexOf('--path')+1],'[tools]\\n');
      console.error('fixture use denied');process.exit(3);
    `,
      )
    },
  )
})

test('command target refresh and task prepend preserve the selected entity', async () => {
  await isolated(
    `
    await app.refresh();app.jumpToPage('Tools');app.state.selected=1;
    const selected=app.selectedTool();
    writeFileSync(dir+'/tools','{"aaa":[{"version":"1"}],"node":[{"version":"20"},{"version":"22"}]}');
    await app.refresh();
    assert.equal(app.selectedTool().name,selected.name);assert.equal(app.selectedTool().version,selected.version);
    const path=dir+'/target.toml';writeFileSync(path,'');app.state.configTarget={path,create:false};
    app.state.jobs.push({id:'retained',kind:'mise',label:'retained',state:'done',startedAt:1,endedAt:2,exitCode:0,lastLine:'old output'});
    app.jumpToPage('Console');
    executeBackground(app, ['install','--yes','example@1'],'new');
    assert.equal(app.visibleItems()[app.state.selected].id,'retained');
    await finished(1);
    assert.equal(app.visibleItems()[app.state.selected].id,'retained');
    assert.equal(app.state.configTarget.path,path);
    app.state.selectedUpdates=new Set(['node','vanished']);await app.refresh();
    assert.equal(app.state.selectedUpdates.has('vanished'),false);
    assert.equal(app.state.selectedUpdates.has('node'),true);
  `,
    ({ dir, executable }) => {
      writeFileSync(join(dir, 'tools'), '{"node":[{"version":"20"},{"version":"22"}]}')
      executable(
        'mise',
        `
      import {readFileSync} from 'node:fs';
      const kind=process.argv[2];
      if(kind==='ls') {
        const tools=JSON.parse(readFileSync(${JSON.stringify(join(dir, 'tools'))},'utf8'));
        for(const records of Object.values(tools))
          for(const record of records)record.source={path:${JSON.stringify(join(dir, 'mise.toml'))}};
        console.log(JSON.stringify(tools));
      } else console.log(kind==='outdated'?'[{"name":"node","current":"20","latest":"22"}]':kind==='config'?'[]':'{}');
    `,
      )
    },
  )
})

test('layout target narrow lists keep the last row highlighted and details scroll actual output', async () => {
  await fixture(
    async ({ app, ui, frame }) => {
      app.state.snapshot.projectTools = tools.map((tool, index) => ({
        ...tool,
        version: `version-${index}`,
      }))
      app.jumpToPage('Tools')
      ui.mockInput.pressKey('END')
      await frame()
      expect(highlighted(ui, 'tool-34')).toBe(true)
      app.state.logs = [
        {
          command: 'fixture output',
          output: Array.from({ length: 60 }, (_, index) => `OUTPUT-${index}`).join('\n'),
          success: true,
        },
      ]
      app.jumpToPage('Logs')
      ui.mockInput.pressEnter()
      const first = await frame()
      ui.mockInput.pressKey('d', { ctrl: true })
      expect(await frame()).not.toBe(first)
      ui.mockInput.pressKey('END')
      expect(await frame()).toContain('OUTPUT-59')
      ui.mockInput.pressKey('HOME')
      expect(await frame()).toBe(first)
    },
    70,
    18,
  )
})

test('EN ZH overlays retain selected targets, input paths and scrollable command contents', async () => {
  for (const language of ['en', 'zh']) {
    for (const [width, height] of [
      [100, 24],
      [70, 18],
    ]) {
      await fixture(
        async ({ app, ui, frame, dir }) => {
          app.state.language = language
          const path = join(dir, 'config with spaces.toml')
          writeFileSync(path, '[tools]\n')
          app.state.snapshot.configs = [{ path, tools: ['node'] }]
          openConfigTarget(app)
          await frame()
          modalRect(ui, t(language, 'config_target_title'))
          expect(highlighted(ui, 'config with spaces.toml')).toBe(true)
          ui.mockInput.pressEnter()
          expect(app.state.configTarget.path).toBe(path)
          for (const intent of [VERSION_INTENT.Use, VERSION_INTENT.Install]) {
            app.state.overlay = {
              type: 'Picker',
              parent: null,
              level: 'versions',
              intent,
              toolSpecName: 'cargo:example',
              versions,
              selected: 34,
            }
            await frame()
            modalRect(ui, t(language, 'picker_versions'))
            expect(highlighted(ui, 'v34')).toBe(true)
          }
          openCustomTool(app)
          expect(app.state.overlay.type).toBe('CustomTool')
          ui.mockInput.pressKey('F2')
          ui.mockInput.pressKey('END')
          ui.mockInput.pressEnter()
          const candidate = join(dir, 'new config.toml')
          for (const key of candidate) ui.mockInput.pressKey(key)
          expect(await frame()).toContain('new config.toml')
          modalRect(ui, t(language, 'config_target_title'))
          ui.mockInput.pressEnter()
          expect(existsSync(candidate)).toBe(false)
          await frame()
          modalRect(ui, t(language, 'confirm_command_title'))
          ui.mockInput.pressKey('n')
          expect(app.state.overlay.input).toBe(candidate)
          app.state.overlay = null
          app.state.snapshot.updates = tools.map(tool => ({
            name: tool.name,
            current: '1',
            latest: '2',
          }))
          app.jumpToPage('Updates')
          ui.mockInput.pressKey('U')
          const first = await frame()
          ui.mockInput.pressKey('END')
          const last = await frame()
          expect(last).toContain('tool-34')
          expect(last).not.toBe(first)
          ui.mockInput.pressKey('n')
        },
        width,
        height,
      )
    }
  }
})

test('layout target long path context scrolls without losing input selection or errors', async () => {
  await fixture(
    async ({ app, ui, frame }) => {
      const path = `/${'long-directory/'.repeat(80)}last-directory/config.toml`
      app.state.snapshot.configs = [{ path, tools: [] }]
      openConfigTarget(app)
      const first = await frame()
      expect(highlighted(ui, 'config.toml')).toBe(true)
      for (let index = 0; index < 10; index++)
        ui.renderer.stdin.emit('data', Buffer.from('\x1B[6~'))
      expect(await frame()).not.toBe(first)
      expect(await frame()).toContain('last-directory')
      expect(app.state.overlay.selected).toBe(0)
      ui.mockInput.pressKey('END')
      ui.mockInput.pressEnter()
      app.state.overlay.input = path
      app.state.overlay.error = 'explicit validation failure'
      expect(await frame()).toContain('explicit validation failure')
      for (let index = 0; index < 10; index++)
        ui.renderer.stdin.emit('data', Buffer.from('\x1B[6~'))
      expect(await frame()).toContain('config.toml')
      expect(app.state.overlay.input).toBe(path)
      app.state.configTarget = { path, create: false }
      openCustomTool(app)
      app.state.overlay.input = 'cargo:example@1'
      app.state.overlay.error = 'explicit write failure'
      expect(await frame()).toContain('explicit write failure')
      for (let index = 0; index < 10; index++)
        ui.renderer.stdin.emit('data', Buffer.from('\x1B[6~'))
      expect(await frame()).toContain('config.toml')
      expect(app.state.overlay.input).toBe('cargo:example@1')
      ui.mockInput.pressEnter()
      expect(await frame()).toContain('Cannot use configuration:')
      expect(app.state.overlay.input).toBe('cargo:example@1')
      expect(app.state.jobs).toEqual([])
    },
    70,
    18,
  )
})

test('config target empty discovery offers project creation and preserves literal path semantics', async () => {
  await isolated(
    `
    await app.refresh();assert.deepEqual(app.state.snapshot.configs,[]);
    openConfigTarget(app);ui.mockInput.pressEnter();
    assert.equal(app.state.overlay.type,'ConfirmCommand');
    assert.ok(app.state.overlay.message.includes(dir+'/mise.toml'));
    ui.mockInput.pressKey('n');assert.equal(app.state.overlay.type,'ConfigTarget');
    assert.equal(existsSync(dir+'/mise.toml'),false);
    ui.mockInput.pressEscape();
    for(const input of ['relative.toml','~/home.toml','$NOT_EXPANDED.toml']) {
      await inputTarget(input);
      assert.equal(app.state.overlay.type,'ConfirmCommand');
      const path=input.startsWith('~/')?homedir()+'/'+input.slice(2):resolve(input);
      assert.ok(app.state.overlay.message.includes(path));
      ui.mockInput.pressKey('n');assert.equal(app.state.overlay.input,input);
      ui.mockInput.pressEscape();assert.equal(app.state.overlay.mode,'list');
      assert.equal(app.state.overlay.input,input);ui.mockInput.pressEscape();
      assert.equal(existsSync(path),false);
    }
    const special=dir+'/socket.toml',server=createServer();
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(special,resolve)});
    try { assert.throws(()=>validateConfigTarget(special),/regular file/) }
    finally { await new Promise(resolve=>server.close(resolve)) }
    assert.deepEqual(argv(),[]);
  `,
    recordedMise,
  )
})

test('config target F2 returns to unchanged picker and custom input without automatic submission', async () => {
  await isolated(
    `
    const first=dir+'/first.toml',second=dir+'/second.toml';
    writeFileSync(first,'');writeFileSync(second,'');
    app.state.snapshot.configs=[{path:first,tools:[]},{path:second,tools:[]}];
    app.state.configTarget={path:first,create:false};
    const parents=[
      {type:'Picker',parent:null,level:'registry',tools:[{name:'example',backends:['cargo']}],backends:['All'],filterIdx:0,search:'example',selected:0},
      {type:'Picker',parent:null,level:'versions',intent:VERSION_INTENT.Use,toolSpecName:'cargo:example',versions:[{version:'1'},{version:'2'}],selected:1},
      {type:'CustomTool',parent:null,input:'cargo:example@latest'},
    ];
    for(const parent of parents) {
      app.state.configTarget={path:first,create:false};app.state.overlay=parent;
      const {input,search,selected,filterIdx}=parent;
      ui.mockInput.pressKey('F2');ui.mockInput.pressKey('j');ui.mockInput.pressEnter();
      assert.equal(app.state.configTarget.path,second);
      assert.equal(app.state.overlay,parent);
      assert.equal(parent.input,input);assert.equal(parent.search,search);
      assert.equal(parent.selected,selected);assert.equal(parent.filterIdx,filterIdx);
      assert.deepEqual(argv(),[]);
    }
    app.state.overlay={type:'Picker',parent:null,level:'versions',intent:VERSION_INTENT.Install,versions:[{version:'1'}],selected:0};
    const install=app.state.overlay;ui.mockInput.pressKey('F2');assert.equal(app.state.overlay,install);
  `,
    recordedMise,
  )
})

test('navigation page commands exclude unrelated dashboard actions and Enter acts on the filtered row', async () => {
  await isolated(
    `
    app.state.commands=[
      {name:'env',description:'Inspect environment'},
      {name:'exec',description:'Execute in environment'},
      {name:'doctor',description:'Diagnose installation'},
    ];
    app.jumpToPage('Environment');openContextCommands(app);
    assert.deepEqual(app.state.overlay.commands.map(command=>command.name),['env','exec']);
    ui.mockInput.pressEscape();
    app.state.search='Execute in environment';app.clampSelection();ui.mockInput.pressKey('R');
    await until(()=>app.state.overlay?.type==='CommandBuilder'&&!app.state.overlay.loading,'filtered command');
    assert.equal(app.state.overlay.command.name,'exec');ui.mockInput.pressCtrlC();
    app.state.snapshot.tasks=[{name:'wrong',description:'Other task'},{name:'right',description:'Needle task'}];
    app.jumpToPage('Tasks');app.state.search='Needle task';app.clampSelection();
    ui.mockInput.pressKey('R');
    assert.equal(app.state.overlay.type,'ConfirmCommand');
    ui.mockInput.pressKey('y');
    await finished(1);
    assert.deepEqual(argv(),[['run','right']]);
    app.jumpToPage('Dashboard');openContextCommands(app);
    assert.deepEqual(app.state.overlay.commands.map(command=>command.name),['doctor']);
    ui.mockInput.pressEscape();
  `,
    recordedMise,
  )
})

test('scope startup selects project and global tab respects mise environment precedence', async () => {
  for (const mode of ['home', 'xdg', 'mise-dir', 'explicit']) {
    await isolated(
      `
      const {realpathSync}=await import('node:fs');
      const mode=${JSON.stringify(mode)};
      delete process.env.MISE_GLOBAL_CONFIG_FILE;
      delete process.env.MISE_CONFIG_DIR;
      delete process.env.XDG_CONFIG_HOME;
      const files=[dir+'/.config/mise/config.toml',dir+'/xdg/mise/config.toml',dir+'/mise-dir/config.toml',dir+'/global config.toml'];
      for(const path of files) {
        mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path,'[tools]\\n');
      }
      if(mode!=='home')process.env.XDG_CONFIG_HOME=dir+'/xdg';
      if(mode==='mise-dir'||mode==='explicit')process.env.MISE_CONFIG_DIR=dir+'/mise-dir';
      if(mode==='explicit')process.env.MISE_GLOBAL_CONFIG_FILE=files[3];
      const expected=files[['home','xdg','mise-dir','explicit'].indexOf(mode)];
      const project=dir+'/mise.toml';writeFileSync(project,'[tools]\\n');
      writeFileSync(dir+'/configs',JSON.stringify([{path:project,tools:[]},...files.map(path=>({path:realpathSync(path),tools:[]}))]));
      await app.start();
      assert.deepEqual(app.state.configTarget,{path:project,create:false});
      app.jumpToPage('Tools');ui.mockInput.pressKey('s');
      assert.deepEqual(app.state.configTarget,{path:expected,create:false});
      assert.equal(app.state.overlay,null);assert.equal(app.state.status,'');
      await openRegistry(app);assert.equal(app.state.overlay.type,'Picker');
      ui.mockInput.pressEscape();
      assert.equal(selectConfigTarget(app, project),true);await app.refresh();
      assert.equal(app.state.configTarget.path,project);
      assert.deepEqual(argv(),[]);
    `,
      ({ dir, executable }) => {
        executable(
          'mise',
          `
        import {readFileSync,appendFileSync} from 'node:fs';
        const args=process.argv.slice(2);
        if(args[0]==='config')console.log(readFileSync(${JSON.stringify(join(dir, 'configs'))},'utf8'));
        else if(['use','install','uninstall','upgrade'].includes(args[0]))appendFileSync(${JSON.stringify(join(dir, 'args'))},JSON.stringify(args)+'\\n');
        else console.log(args[0]==='registry'?'[]':'{}');
      `,
        )
      },
    )
  }
})

test('config target startup neither creates missing globals nor overrides explicit selection', async () => {
  for (const mode of ['missing', 'invalid', 'discovery-failed', 'manual']) {
    await isolated(
      `
      const mode=${JSON.stringify(mode)};
      const global=dir+'/global.toml',project=dir+'/mise.toml';
      process.env.MISE_GLOBAL_CONFIG_FILE=global;
      writeFileSync(project,'[tools]\\n');
      if(mode==='invalid')mkdirSync(global);
      else if(mode!=='missing')writeFileSync(global,'[tools]\\n');
      writeFileSync(dir+'/configs',mode==='discovery-failed'?'{}':JSON.stringify([{path:project,tools:[]},{path:global,tools:[]}]));
      if(mode==='manual')selectConfigTarget(app, project);
      await app.start();
      assert.equal(app.state.configTarget?.path??null,['manual','missing'].includes(mode)?project:null);
      assert.equal(app.state.overlay,null);assert.deepEqual(argv(),[]);
      if(mode==='missing')assert.equal(existsSync(global),false);
      if(mode==='invalid')assert.match(app.state.status,/regular file/);
      if(mode==='discovery-failed')assert.match(app.state.status,/mise config ls --json/);
    `,
      ({ dir, executable }) => {
        executable(
          'mise',
          `
        import {readFileSync,appendFileSync} from 'node:fs';
        const args=process.argv.slice(2);
        if(args[0]==='config')console.log(readFileSync(${JSON.stringify(join(dir, 'configs'))},'utf8'));
        else if(['use','install','uninstall','upgrade'].includes(args[0]))appendFileSync(${JSON.stringify(join(dir, 'args'))},JSON.stringify(args)+'\\n');
        else console.log('{}');
      `,
        )
      },
    )
  }
})

test('L switches the whole frame to Chinese and persists it', async () => {
  await fixture(async ({ app, ui, frame, path }) => {
    expect(app.state.language).toBe('en')
    expect(await frame()).toContain('Dashboard')
    ui.mockInput.pressKey('l', { shift: true })
    expect(app.state.language).toBe('zh')
    expect(JSON.parse(readFileSync(path, 'utf8')).language).toBe('zh')
    const rendered = await frame()
    expect(rendered).toContain('仪表盘')
    expect(rendered).not.toContain('Dashboard')
    ui.mockInput.pressKey('l', { shift: true })
    expect(app.state.language).toBe('en')
    expect(JSON.parse(readFileSync(path, 'utf8')).language).toBe('en')
  })
})

test('shutdown drains a running process without rendering into destroyed nodes', async () => {
  await isolated(`
    const pending = app.runner.submit({
      kind: 'task',
      label: 'shutdown fixture',
      cmd: [process.execPath, '--eval', "console.log('ready');setInterval(()=>{},1000)"],
    });
    await until(()=>app.state.jobs.some(job=>job.lastLine==='ready'), 'running child');
    ui.renderer.destroy();
    await app.close();
    assert.equal((await pending).state, 'canceled');
    assert.ok(app.state.jobs.every(job=>!['queued','running'].includes(job.state)));
  `)
})

test('jobs stream into the status box, quit confirms, and x cancels the newest', async () => {
  await fixture(async ({ app, ui, frame }) => {
    let release
    const held = new Promise((resolve) => {
      release = resolve
    })
    const aborted = []
    const originalAbort = app.runner.abort
    app.runner.abort = (id) => {
      aborted.push(id)
      return originalAbort(id)
    }
    const settled = app.runner.submit({
      kind: 'task',
      label: 'fixture job',
      run: async (api) => {
        api.setLast('working…')
        await held
      },
    })
    let rendered = await frame()
    expect(rendered).toContain('1 active')
    expect(rendered).toContain('▶ fixture job')
    expect(rendered).toContain('working…')
    ui.mockInput.pressKey('q')
    expect(app.state.overlay.type).toBe('Quit')
    expect(app.state.overlay.message).toContain('jobs still running')
    ui.mockInput.pressEscape()
    expect(app.state.overlay).toBeNull()
    ui.mockInput.pressKey('x')
    expect(aborted.length).toBe(1)
    rendered = await frame()
    expect(rendered).toContain('⊘')
    expect(rendered).toContain('canceled')
    release()
    const job = await settled
    expect(job.state).toBe('canceled')
    expect(app.state.jobs[0].state).toBe('canceled')
  })
})

test('search overlay range chip switches to registry add search with all four states', async () => {
  await isolated(
    `
    ui.mockInput.pressKey('/');
    assert.equal(app.state.overlay.range,'local');
    assert.equal(app.state.search,'');
    ui.mockInput.pressTab();
    assert.equal(app.state.overlay.range,'add');
    assert.equal(app.state.overlay.loading,true);
    await until(()=>app.state.overlay && app.state.overlay.loading===false,'registry load');
    assert.ok(!app.state.overlay.loadError);
    type('example');
    assert.ok(filterRegistryTools(app.state.overlay).some(tool=>tool.name==='example'));
    ui.mockInput.pressKey('u',{ctrl:true});
    type('zz');
    assert.equal(filterRegistryTools(app.state.overlay).length,0);
    ui.mockInput.pressKey('u',{ctrl:true});
    type('example');
    ui.mockInput.pressTab();
    assert.equal(app.state.overlay.range,'local');
    ui.mockInput.pressEscape();
    assert.equal(app.state.overlay,null);
    assert.equal(app.state.search,'');
  `,
    recordedMise,
  )
})

test('tool scope switching restores positions and write targets without changing pages', async () => {
  await fixture(async ({ app, ui, dir }) => {
    const previous = process.env.MISE_GLOBAL_CONFIG_FILE
    const globalPath = join(dir, 'global.toml')
    const projectPath = join(dir, 'project.toml')
    writeFileSync(globalPath, '[tools]\n')
    writeFileSync(projectPath, '[tools]\n')
    process.env.MISE_GLOBAL_CONFIG_FILE = globalPath
    try {
      const inherited = { name: 'bun', version: '1', source: globalPath, scope: 'global', active: true }
      const local = { name: 'node', version: '24', source: projectPath, scope: 'project', active: true }
      const overridden = { name: 'node', version: '22', source: globalPath, scope: 'global', active: false }
      app.state.snapshot.projectTools = [inherited, local]
      app.state.snapshot.globalTools = [inherited, overridden]
      app.state.snapshot.configs = [{ path: projectPath, tools: ['node'] }, { path: globalPath, tools: ['bun', 'node'] }]
      app.setConfigTarget({ path: projectPath, create: false })
      app.jumpToPage('Tools')
      ui.mockInput.pressKey('j')
      expect(app.selectedTool()).toBe(local)
      ui.mockInput.pressKey('s')
      expect(app.state.page).toBe('Tools')
      expect(app.state.toolScope).toBe('global')
      expect(app.state.configTarget.path).toBe(globalPath)
      expect(app.visibleItems()).toEqual([inherited, overridden])
      ui.mockInput.pressKey('j')
      expect(app.selectedTool()).toBe(overridden)
      ui.mockInput.pressKey('s')
      expect(app.state.toolScope).toBe('project')
      expect(app.selectedTool()).toBe(local)
      expect(app.state.configTarget.path).not.toBe(globalPath)
      ui.mockInput.pressKey('s')
      expect(app.selectedTool()).toBe(overridden)
      ui.mockInput.pressKey('/')
      ui.mockInput.pressKey('[')
      expect(app.state.search).toBe('[')
      expect(app.state.toolScope).toBe('global')
      ui.mockInput.pressEscape()
      app.setConfigTarget({ path: projectPath, create: false })
      expect(app.state.toolScope).toBe('project')
      expect(app.state.configTarget.path).toBe(projectPath)
      rmSync(globalPath)
      mkdirSync(globalPath)
      ui.mockInput.pressKey('s')
      expect(app.state.toolScope).toBe('global')
      expect(app.state.configTarget).toBeNull()
      expect(app.state.status).toContain(globalPath)
      expect(app.state.jobs).toEqual([])
      app.setConfigTarget({ path: projectPath, create: false })
      ui.mockInput.pressKey('1')
      ui.mockInput.pressKey(']')
      expect(app.state.page).toBe('Updates')
      expect(app.state.toolScope).toBe('project')
    }
    finally {
      if (previous === undefined)
        delete process.env.MISE_GLOBAL_CONFIG_FILE
      else process.env.MISE_GLOBAL_CONFIG_FILE = previous
    }
  })
})

test('scoped snapshots retain overridden global declarations and exclude unconfigured installs', async () => {
  await isolated(
    `
    const global=dir+'/global.toml',project=dir+'/mise.toml';
    process.env.MISE_GLOBAL_CONFIG_FILE=global;
    writeFileSync(global,'[tools]\\n');writeFileSync(project,'[tools]\\n');
    await app.refresh();
    assert.equal(app.state.status,'');
    app.jumpToPage('Tools');
    assert.deepEqual(app.visibleItems().map(t=>[t.name,t.version,t.scope]),[
      ['bun','1','global'],['node','24','project'],
    ]);
    ui.mockInput.pressKey('s');
    assert.deepEqual(app.visibleItems().map(t=>[t.name,t.version,t.active]),[
      ['bun','1',true],['node','22',false],
    ]);
    assert.equal(app.state.configTarget.path,global);
    assert.equal(app.state.snapshot.tools.some(t=>t.name==='python'),true);
  `,
    ({ dir, executable }) => {
      executable(
        'mise',
        `
      const args=process.argv.slice(2),global=${JSON.stringify(join(dir, 'global.toml'))},project=${JSON.stringify(join(dir, 'mise.toml'))};
      if(args[0]==='ls')console.log(JSON.stringify(args.includes('--global')?{
        bun:[{version:'1',active:true,source:{path:global}}],
        node:[{version:'22',active:true,source:{path:global}}],
      }:{
        bun:[{version:'1',active:true,source:{path:global}}],
        node:[{version:'24',active:true,source:{path:project}}],
        python:[{version:'3',installed:true}],
      }));
      else console.log(args[0]==='config'?JSON.stringify([{path:project,tools:['node']},{path:global,tools:['node','bun']}]):'{}');
    `,
      )
    },
  )
})
