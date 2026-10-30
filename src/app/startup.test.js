import { expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '../process.js'

async function isolated(run, setup = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lazymise-startup-'))
  try {
    setup({
      dir,
      executable(body) {
        const path = join(dir, 'mise')
        writeFileSync(path, `#!${process.execPath}\n${body}`)
        chmodSync(path, 0o755)
      },
    })
    const script = `
      import assert from 'node:assert/strict';
      import { existsSync, rmSync, writeFileSync } from 'node:fs';
      const dir = ${JSON.stringify(dir)};
      const miseUrl = ${JSON.stringify(new URL('../mise.js', import.meta.url).href)};
      const controllerUrl = ${JSON.stringify(new URL('./controller.js', import.meta.url).href)};
      const mise = await import(miseUrl);
      process.chdir(dir);
      async function until(check, label) {
        const deadline = Date.now() + 5000;
        while (!check()) {
          if (Date.now() > deadline) throw Error('Timed out: ' + label);
          await new Promise(resolve => setImmediate(resolve));
        }
      }
      ${run}
    `
    const { stdout, stderr, exitCode } = await runProcess(process.execPath, ['--eval', script], {
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
    expect({ exitCode, stdout: exitCode ? stdout : '', stderr: exitCode ? stderr : '' }).toEqual({
      exitCode: 0,
      stdout: '',
      stderr: '',
    })
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('delayed outdated leaves the local snapshot and command catalog ready at startup', async () => {
  await isolated(
    `
      const { Application } = await import(controllerUrl);
      const app = new Application(() => {}, () => {});
      let started = false;
      const pending = app.start().then(() => { started = true; });
      let snapshot;
      try {
        await until(() => existsSync(dir + '/outdated.ready'), 'outdated request');
        await until(() => app.state.snapshot.tools.length === 1, 'local snapshot before outdated release');
        snapshot = app.state.snapshot;
        assert.equal(snapshot.tools[0].name, 'node');
        assert.equal(snapshot.tasks[0].name, 'build');
        assert.equal(snapshot.configs[0].path, dir + '/mise.toml');
        await until(() => started, 'startup and command catalog before outdated release');
        assert.deepEqual(app.state.commands, [{ name: 'env', description: 'Show environment' }]);
        assert.equal(app.state.loading, false);
        assert.equal(app.state.updatesLoading, true);
        assert.equal(app.state.updatesError, '');
        assert.deepEqual(snapshot.updates, []);
        assert.equal(existsSync(dir + '/outdated.release'), false);
      } finally {
        writeFileSync(dir + '/outdated.release', '');
        await pending;
      }
      try {
        await until(() => !app.state.updatesLoading, 'outdated completion');
        assert.equal(app.state.snapshot, snapshot, 'updates must not replace local data');
        assert.deepEqual(snapshot.updates, [{ name: 'node', current: '20', latest: '22' }]);
        for (const raw of ['broken', '{}', '[null]', '[{"name":""}]']) {
          writeFileSync(dir + '/updates', raw);
          await assert.rejects(mise.loadUpdates(), /mise outdated --json:/);
        }
        writeFileSync(dir + '/outdated.failure', '');
        await assert.rejects(mise.loadUpdates(), /mise outdated --json:.*fixture offline/);
        rmSync(dir + '/outdated.failure');
        writeFileSync(dir + '/updates', '[]');
        assert.deepEqual(await mise.loadUpdates(), []);
      } finally {
        await app.close();
      }
    `,
    ({ dir, executable }) => {
      mkdirSync(join(dir, '.config', 'mise'), { recursive: true })
      writeFileSync(join(dir, 'mise.toml'), '[tools]\nnode = "20"\n')
      writeFileSync(join(dir, 'updates'), '[{"name":"node","current":"20","latest":"22"}]')
      executable(`
        import { existsSync, readFileSync, watch, writeFileSync } from 'node:fs';
        const dir = ${JSON.stringify(dir)}, kind = process.argv[2];
        if (kind === 'outdated') {
          if (!existsSync(dir + '/outdated.release')) {
            await new Promise(resolve => {
              const observer = watch(dir, () => {
                if (existsSync(dir + '/outdated.release')) { observer.close(); resolve(); }
              });
              writeFileSync(dir + '/outdated.ready', '');
            });
          }
          if (existsSync(dir + '/outdated.failure')) {
            console.error('fixture offline'); process.exit(4);
          }
          console.log(readFileSync(dir + '/updates', 'utf8'));
        } else if (kind === 'ls') {
          console.log(JSON.stringify({ node: [{ version: '20', active: true, source: { path: dir + '/mise.toml' } }] }));
        } else if (kind === 'tasks') {
          console.log('[{"name":"build","description":"Build project","run":"build"}]');
        } else if (kind === 'config') {
          console.log(JSON.stringify([{ path: dir + '/mise.toml', tools: ['node'] }]));
        } else if (kind === '-h') {
          console.log('Commands:\\n  env  Show environment');
        } else {
          console.log('2026.1.0');
        }
      `)
    },
  )
})

test('independent update generations retain rows and marks and ignore stale or closed results', async () => {
  await isolated(`
    const { mock } = await import('bun:test');
    const snapshots = [], updates = [], catalogs = [];
    function defer(queue) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      queue.push({ promise, resolve, reject });
      return promise;
    }
    async function succeed(request, value) {
      request.resolve(value);
      await request.promise;
    }
    async function fail(request, error) {
      request.reject(error);
      await request.promise.catch(() => {});
    }
    function snapshot(name) {
      const tools = [{ name, version: '1' }];
      return { mise_version: name, tools, projectTools: tools, globalTools: [], updates: [], tasks: [], configs: [] };
    }
    mock.module(miseUrl, () => ({
      ...mise,
      loadSnapshot: () => defer(snapshots),
      loadUpdates: () => defer(updates),
      commandCatalog: () => defer(catalogs),
    }));
    const { Application } = await import(controllerUrl);
    let renders = 0;
    const app = new Application(() => { renders++; }, () => {});
    app.state.snapshot = snapshot('initial');
    const oldRows = [{ name: 'remove' }, { name: 'keep' }];
    app.state.snapshot.updates = oldRows;
    app.state.selectedUpdates = new Set(['remove', 'keep']);
    app.jumpToPage('Updates');
    app.state.selected = 1;
    app.jumpToPage('Tools');

    const first = app.refresh(), second = app.refresh();
    assert.equal(app.state.updatesLoading, true);
    assert.equal(app.state.snapshot.updates, oldRows);
    assert.deepEqual([...app.state.selectedUpdates], ['remove', 'keep']);
    await succeed(snapshots[1], snapshot('newest-local'));
    assert.equal(await second, true, 'local refresh must finish while updates are unresolved');
    assert.equal(app.state.snapshot.updates, oldRows);
    assert.deepEqual([...app.state.selectedUpdates], ['remove', 'keep']);
    const latestSnapshot = app.state.snapshot;
    const newRows = [{ name: 'aaa' }, { name: 'bbb' }, { name: 'keep' }];
    await succeed(updates[1], newRows);
    assert.equal(app.state.snapshot, latestSnapshot);
    assert.equal(app.state.snapshot.updates, newRows);
    assert.equal(app.state.updatesLoading, false);
    assert.deepEqual([...app.state.selectedUpdates], ['keep']);
    assert.equal(app.state.page, 'Tools');
    app.jumpToPage('Updates');
    assert.equal(app.state.selected, 2, 'saved update selection follows its identity');
    assert.equal(app.selectedUpdate().name, 'keep');

    await succeed(snapshots[0], snapshot('stale-local'));
    assert.equal(await first, false);
    await succeed(updates[0], [{ name: 'stale-update' }]);
    assert.equal(app.state.snapshot, latestSnapshot);
    assert.equal(app.state.snapshot.updates, newRows);
    assert.deepEqual([...app.state.selectedUpdates], ['keep']);

    const third = app.refresh(), fourth = app.refresh();
    await fail(updates[2], Error('stale offline'));
    assert.equal(app.state.updatesLoading, true, 'stale failure cannot finish the newer check');
    assert.equal(app.state.updatesError, '');
    assert.equal(app.state.snapshot.updates, newRows);
    await succeed(snapshots[2], snapshot('stale-again'));
    assert.equal(await third, false);
    await succeed(snapshots[3], snapshot('fourth-local'));
    assert.equal(await fourth, true);
    await fail(updates[3], Error('current offline'));
    assert.equal(app.state.updatesLoading, false);
    assert.equal(app.state.updatesError, 'current offline');
    assert.equal(app.state.snapshot.updates, newRows);
    assert.deepEqual([...app.state.selectedUpdates], ['keep']);
    assert.equal(app.selectedUpdate().name, 'keep');

    const retry = app.refresh();
    assert.equal(app.state.updatesLoading, true);
    assert.equal(app.state.updatesError, '');
    assert.equal(app.state.snapshot.updates, newRows);
    assert.deepEqual([...app.state.selectedUpdates], ['keep']);
    const retryRows = [{ name: 'keep' }, { name: 'aaa' }];
    await succeed(updates[4], retryRows);
    assert.equal(app.selectedUpdate().name, 'keep');
    assert.equal(app.state.selected, 0, 'active update selection follows its identity');
    await succeed(snapshots[4], snapshot('retry-local'));
    assert.equal(await retry, true);
    assert.equal(app.state.snapshot.updates, retryRows, 'late local data cannot erase new updates');

    const empty = app.refresh();
    await succeed(snapshots[5], snapshot('empty-local'));
    assert.equal(await empty, true);
    assert.equal(app.state.snapshot.updates, retryRows);
    await succeed(updates[5], []);
    assert.deepEqual(app.state.snapshot.updates, []);
    assert.equal(app.state.selectedUpdates.size, 0);
    assert.equal(app.state.updatesError, '');
    assert.equal(app.state.updatesLoading, false);

    const closing = app.refresh();
    const beforeClose = app.state.snapshot;
    await app.close();
    const closedRenders = renders;
    await succeed(snapshots[6], snapshot('closed-local'));
    assert.equal(await closing, false);
    await fail(updates[6], Error('closed offline'));
    assert.equal(app.state.snapshot, beforeClose);
    assert.equal(app.state.updatesError, '');
    assert.equal(renders, closedRenders);

    const startup = new Application(() => { renders++; }, () => {});
    const starting = startup.start();
    await succeed(snapshots[7], snapshot('startup-local'));
    await until(() => catalogs.length === 1, 'startup command catalog');
    await startup.close();
    const startupSnapshot = startup.state.snapshot, startupRenders = renders;
    await succeed(catalogs[0], [{ name: 'env' }]);
    await starting;
    await succeed(updates[7], [{ name: 'closed-startup-update' }]);
    assert.equal(startup.state.snapshot, startupSnapshot);
    assert.deepEqual(startup.state.snapshot.updates, []);
    assert.deepEqual(startup.state.commands, []);
    assert.equal(renders, startupRenders);

    const early = new Application(() => { renders++; }, () => {});
    const earlyStarting = early.start();
    await early.close();
    const earlySnapshot = early.state.snapshot, earlyRenders = renders;
    await succeed(snapshots[8], snapshot('closed-before-local'));
    await earlyStarting;
    await succeed(updates[8], [{ name: 'closed-early-update' }]);
    assert.equal(early.state.snapshot, earlySnapshot);
    assert.equal(catalogs.length, 1, 'close before the snapshot must not start the command catalog');
    assert.equal(renders, earlyRenders);
  `)
})
