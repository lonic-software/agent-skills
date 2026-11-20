'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const {
  projectState,
  createIntentJournal,
  readJSON,
} = require('../codex/runtime/managed-storage.cjs');
const { reconcileManaged } = require('../codex/runtime/managed-reconcile.cjs');
const {
  enrollManagedAccount,
} = require('../codex/runtime/managed-enrollment.cjs');
const { parse, main } = require('../codex/runtime/managed-cli.cjs');
const { PassThrough } = require('node:stream');
async function fixture(action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-reconcile-')),
    project = path.join(root, 'project'),
    stateRoot = path.join(root, 'state');
  fs.mkdirSync(project);
  const { dir } = projectState(stateRoot, project),
    file = path.join(dir, 'intent.json');
  const journal = createIntentJournal(dir, 'EXAMPLE-run');
  journal.begin({ pid: 42, created: '100' });
  journal.register({ id: 'author-1', generation: 'one' });
  journal.recordIdentity({ pid: 43, parentPid: 42, created: '101' });
  journal.recordIdentity({ pid: 44, parentPid: 43, created: '102' });
  let observations = 0,
    prompts = 0,
    signals = 0,
    releases = 0;
  const cfg = {
    project,
    stateRoot,
    terminal: {
      inputTTY: true,
      outputTTY: true,
      confirm: async (text) => {
        prompts++;
        assert.match(text, /author-1/);
        assert.match(text, /101/);
        return 'RECONCILE';
      },
    },
  };
  const dep = {
    adapter: {},
    backend: {
      observe: async () => {
        observations++;
        return { complete: true, processes: [] };
      },
      signal: () => {
        signals++;
        throw Error('NO_SIGNALS');
      },
    },
    gate: {
      acquire: async () => ({ allowed: true }),
      check: async () => ({ allowed: true }),
      release: async () => {
        releases++;
        return { allowed: true };
      },
    },
  };
  try {
    await action({
      cfg,
      dep,
      file,
      dir,
      journal,
      counts: () => ({ observations, prompts, signals, releases }),
    });
  } finally {
    assert.equal(signals, 0);
    if (path.dirname(fs.realpathSync(root)) !== fs.realpathSync(os.tmpdir()))
      throw Error('PATH');
    fs.rmSync(root, { recursive: true });
  }
}
test('interactive recovery archives original, checks absence twice, then permits next journal', () =>
  fixture(async (f) => {
    assert.deepEqual(await reconcileManaged(f.cfg, f.dep), {
      status: 'reconciled',
      count: 1,
    });
    assert.deepEqual(f.counts(), {
      observations: 2,
      prompts: 1,
      signals: 0,
      releases: 1,
    });
    assert.equal(readJSON(f.file).status, 'settled');
    assert.equal(
      fs.readdirSync(f.dir).filter((x) => x.endsWith('.previous.json')).length,
      1,
    );
    createIntentJournal(f.dir, 'next').begin({ pid: 45, created: '200' });
  }));

for (const afterReboot of [false, true])
  test(
    'S37 CLI shows unresolved JSON exactly once before confirmation: afterReboot=' +
      afterReboot,
    () =>
      fixture(async (f) => {
        const output = [],
          order = [];
        if (afterReboot) {
          const state = readJSON(f.file);
          state.owner.created = '638000000000000000';
          fs.writeFileSync(f.file, JSON.stringify(state));
          f.dep.readBoot = async () => '638100000000000000';
        }
        const observe = f.dep.backend.observe;
        f.dep.backend.observe = async () => {
          order.push('observe');
          return observe();
        };
        const terminal = {
          inputTTY: true,
          outputTTY: true,
          display: (text) => {
            order.push('display');
            output.push(text);
          },
          confirm: async (text) => {
            order.push('confirm');
            output.push(text);
            return afterReboot ? 'RECONCILE-AFTER-REBOOT' : 'RECONCILE';
          },
        };
        const stderr = new PassThrough();
        stderr.resume();
        const args = [
          '--managed',
          '--reconcile',
          '--project',
          f.cfg.project,
          '--state-root',
          f.cfg.stateRoot,
          ...(afterReboot ? ['--after-reboot'] : []),
        ];
        assert.equal(
          await main(args, {
            stderr,
            terminal,
            reconcile: (options) => reconcileManaged(options, f.dep),
            createHost: () => {
              throw Error('NO_PROFILE');
            },
          }),
          0,
        );
        assert.equal(output.join('\n').split('"unresolved":').length - 1, 1);
        assert.match(output[0], /author-1/);
        assert.doesNotMatch(output[1], /"unresolved":/);
        assert.deepEqual(order, ['display', 'observe', 'confirm', 'observe']);
        assert.equal(readJSON(f.file).status, 'settled');
        assert.equal(f.counts().signals, 0);
      }),
  );
for (const pid of [42, 43, 44])
  test('recovery refuses live full identity ' + pid, () =>
    fixture(async (f) => {
      f.dep.backend.observe = async () => ({
        complete: true,
        processes: [{ pid, created: String(pid + 58) }],
      });
      await assert.rejects(reconcileManaged(f.cfg, f.dep), /PROCESS_LIVE/);
      assert.equal(f.counts().prompts, 0);
      assert.equal(readJSON(f.file).status, 'active');
    }),
  );
test('a reused PID with different creation time is not signalled or mistaken for the old process', () =>
  fixture(async (f) => {
    f.dep.backend.observe = async () => ({
      complete: true,
      processes: [
        { pid: 43, created: '999' },
        { pid: 0, created: '' },
      ],
    });
    assert.equal((await reconcileManaged(f.cfg, f.dep)).status, 'reconciled');
  }));
for (const kind of [
  'legacy',
  'uncertain',
  'cancel',
  'changed',
  'second-live',
  'gate-lost',
  'non-tty',
])
  test('recovery fails closed: ' + kind, () =>
    fixture(async (f) => {
      if (kind === 'legacy') {
        const x = readJSON(f.file);
        delete x.intents[0].identities;
        x.intents[0].pidHint = 43;
        fs.writeFileSync(f.file, JSON.stringify(x));
      }
      if (kind === 'uncertain')
        f.dep.backend.observe = async () => ({
          complete: false,
          processes: [],
        });
      if (kind === 'non-tty') f.cfg.terminal.inputTTY = false;
      if (kind === 'gate-lost')
        f.dep.gate.check = async () => ({ allowed: false });
      if (['cancel', 'changed', 'second-live'].includes(kind))
        f.cfg.terminal.confirm = async () => {
          if (kind === 'cancel') return 'yes';
          if (kind === 'changed') fs.appendFileSync(f.file, '\n');
          if (kind === 'second-live')
            f.dep.backend.observe = async () => ({
              complete: true,
              processes: [{ pid: 43, created: '101' }],
            });
          return 'RECONCILE';
        };
      await assert.rejects(reconcileManaged(f.cfg, f.dep));
      assert.equal(readJSON(f.file).status, 'active');
    }),
  );
test('recovery CLI is explicitly managed, exclusive, and does not construct a profile host', async () => {
  const args = [
    '--managed',
    '--reconcile',
    '--project',
    'fixture',
    '--state-root',
    'state',
  ];
  assert.equal(parse(args)['--reconcile'], true);
  assert.throws(() => parse([...args, '--enroll']));
  assert.throws(() => parse([...args, '--profile', 'forbidden']));
  const stderr = new PassThrough();
  stderr.resume();
  let calls = 0;
  assert.equal(
    await main(args, {
      stderr,
      terminal: { inputTTY: true, outputTTY: true },
      createHost: () => {
        throw Error('NO_PROFILE');
      },
      reconcile: async () => {
        calls++;
        return { status: 'reconciled' };
      },
    }),
    0,
  );
  assert.equal(calls, 1);
});
test('reenrollment requires explicit confirmation before any host action', async () => {
  let starts = 0;
  await assert.rejects(
    enrollManagedAccount(
      {
        beginEnrollment: () => {
          starts++;
        },
        dispose: async () => {},
      },
      { inputTTY: true, outputTTY: true, confirm: async () => 'yes' },
      { replace: true },
    ),
  );
  assert.equal(starts, 0);
});
test('an explicitly never-attempted intent can be settled after its controller is absent', () =>
  fixture(async (f) => {
    const record = readJSON(f.file);
    delete record.intents[0].identities;
    record.intents[0].spawnAttempted = false;
    fs.writeFileSync(f.file, JSON.stringify(record));
    f.cfg.terminal.confirm = async () => 'RECONCILE';
    assert.equal((await reconcileManaged(f.cfg, f.dep)).status, 'reconciled');
  }));
test('an attempted spawn without observed identity remains uncertain', () =>
  fixture(async (f) => {
    const record = readJSON(f.file);
    delete record.intents[0].identities;
    record.intents[0].spawnAttempted = true;
    fs.writeFileSync(f.file, JSON.stringify(record));
    await assert.rejects(reconcileManaged(f.cfg, f.dep), /IDENTITY_MISSING/);
  }));
test('failed write-ahead spawn registration prevents launch', async () => {
  let spawned = 0;
  const {
    createManagedProcess,
  } = require('../codex/runtime/managed-process.cjs');
  const owner = createManagedProcess({
    mode: 'managed',
    backend: {
      observe: async () => ({ complete: true, processes: [] }),
      signal: async () => {
        throw Error();
      },
    },
    onSpawnAttempt: () => {
      throw Error('PERSISTENCE_FAILED');
    },
  });
  assert.equal(
    (
      await owner.start({
        registeredIntent: { id: 'EXAMPLE', generation: 'EXAMPLE' },
        spawn: () => {
          spawned++;
        },
      })
    ).allowed,
    false,
  );
  assert.equal(spawned, 0);
});
