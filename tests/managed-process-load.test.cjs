'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  { spawn } = require('node:child_process');
const {
  createManagedProcess,
  bounded,
} = require('../codex/runtime/managed-process.cjs');
const {
  createWindowsTreeBackend,
} = require('../codex/runtime/managed-windows-tree.cjs');
const loadTestSkip =
  process.platform !== 'win32'
    ? 'Windows-only Git/cmd process-load diagnostic'
    : process.env.LONIC_TEST_PROCESS_LOAD === '1'
      ? false
      : 'S35 opt-in diagnostic: set LONIC_TEST_PROCESS_LOAD=1 to run the flaky 30-second Git/cmd process-load test';
test(
  'S9/S10/S11 real 30-second Git and cmd workload settles without unjustified stop',
  { skip: loadTestSkip, timeout: 100000 },
  async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-managed-load-')),
      nonce = 'EXAMPLE-' + crypto.randomUUID();
    const backend = createWindowsTreeBackend({
        mode: 'managed',
        commandTimeoutMs: 12000,
      }),
      reported = new Map(),
      permitted = new Map(),
      stops = [],
      timings = [];
    let child,
      phase = 'startup',
      done;
    const completed = new Promise((r) => (done = r));
    const wrapped = {
      prepare: () => backend.prepare(),
      observe: async () => {
        const start = performance.now(),
          view = await backend.observe();
        timings.push({ phase, ms: performance.now() - start });
        for (const p of view.processes) {
          const expected = reported.get(p.pid);
          if (expected && expected.parentPid === p.parentPid) {
            const previous = permitted.get(p.pid);
            if (previous)
              assert.deepEqual(
                p,
                previous,
                'test-owned identity must not be reused',
              );
            else permitted.set(p.pid, { ...p });
          }
        }
        return view;
      },
      signal: async (p) => {
        assert.ok(
          reported.has(p.pid),
          'only explicitly reported own spawn may be signalled',
        );
        assert.deepEqual(p, permitted.get(p.pid));
        return backend.signal(p);
      },
    };
    const cadence =
      process.env.LONIC_TEST_MONITOR_MS === undefined
        ? undefined
        : Number(process.env.LONIC_TEST_MONITOR_MS);
    const owner = createManagedProcess({
      mode: 'managed',
      backend: wrapped,
      timeoutMs: 15000,
      closeTimeoutMs: 40000,
      ...(cadence === undefined ? {} : { monitorMs: cadence }),
      onStop: (code) => stops.push(code),
    });
    t.after(async () => {
      phase = 'cleanup';
      await owner.close({ turnCompleted: false });
      if (child?.exitCode === null) {
        const closed = new Promise((r) => child.once('close', r));
        child.send({ nonce, action: 'exit' });
        await bounded(() => closed, 5000);
      }
      assert.equal(
        path.dirname(fs.realpathSync(dir)),
        fs.realpathSync(os.tmpdir()),
      );
      assert.ok(path.basename(dir).startsWith('lonic-managed-load-'));
      assert.equal(fs.lstatSync(dir).isSymbolicLink(), false);
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const result = await owner.start({
      registeredIntent: { id: nonce, generation: 'EXAMPLE-load' },
      spawn: () => {
        child = spawn(
          process.execPath,
          [
            path.join(__dirname, 'fixtures/managed-load-stub.cjs'),
            'root',
            nonce,
            dir,
          ],
          {
            windowsHide: true,
            detached: true,
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          },
        );
        reported.set(child.pid, { parentPid: process.pid });
        child.on('message', (m) => {
          if (m?.nonce !== nonce) return;
          if (m.event === 'spawn') {
            assert.ok(
              reported.has(m.parentPid),
              'spawn lineage belongs to fixture',
            );
            permitted.delete(m.pid);
            reported.set(m.pid, { parentPid: m.parentPid });
          }
          if (m.event === 'workload-done' || m.event === 'workload-failed')
            done(m);
        });
        return child;
      },
    });
    assert.equal(result.allowed, true, JSON.stringify(result));
    phase = 'live';
    child.send({ nonce, action: 'run' });
    const work = await bounded(() => completed, 65000),
      beforeClose = owner.status();
    phase = 'close';
    const close = await owner.close({ turnCompleted: true });
    const record = {
      cadenceMs: cadence ?? 5000,
      workload: work,
      monitor: beforeClose.monitor,
      close,
      stops,
      liveObservations: timings.filter((v) => v.phase === 'live').length,
      liveObservationMs: timings
        .filter((v) => v.phase === 'live')
        .reduce((s, v) => s + v.ms, 0),
      timings,
    };
    // The nonce is only a test correlation token, not an account identifier.
    t.diagnostic(JSON.stringify(record));
    assert.equal(work.event, 'workload-done');
    assert.ok(work.elapsedMs >= 30000);
    for (const value of Object.values(work.counts)) assert.ok(value > 0);
    assert.deepEqual(stops, []);
    assert.equal(close.allowed, true, JSON.stringify(close));
    assert.equal(close.recoveryRequired, false);
    assert.ok(beforeClose.monitor.successful >= 2);
    assert.ok(
      beforeClose.monitor.transientOrphans >= 1,
      'long intermediate is sampled before it exits',
    );
  },
);
