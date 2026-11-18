'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  { EventEmitter } = require('node:events');
const {
  createManagedProcess,
} = require('../codex/runtime/managed-process.cjs');
function fixture(extra = {}) {
  const child = new EventEmitter();
  child.pid = 900001;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.end = () => {};
  const root = { pid: child.pid, parentPid: process.pid, created: '100' },
    leaf = { pid: 900002, parentPid: child.pid, created: '101' };
  let rows = [root, leaf],
    observes = 0,
    closed = false;
  const signals = [],
    stops = [];
  function finish({ stderr = true } = {}) {
    if (closed) return;
    closed = true;
    child.emit('exit', 0);
    child.stdout.emit('close');
    if (stderr) child.stderr.emit('close');
    child.emit('close', 0);
  }
  const backend = {
    observe: async () => {
      observes++;
      return { complete: true, processes: rows.map((p) => ({ ...p })) };
    },
    signal: async (p) => {
      signals.push({ ...p });
      rows = rows.filter((x) => x.pid !== p.pid);
      if (p.pid === root.pid) finish();
      return { verified: true, status: 'signalled' };
    },
  };
  const owner = createManagedProcess({
    mode: 'managed',
    backend,
    onStop: (x) => stops.push(x),
    timeoutMs: 100,
    pollMs: 1,
    maxRounds: 4,
    quietRounds: 2,
    ...extra,
  });
  return {
    owner,
    child,
    backend,
    root,
    leaf,
    signals,
    stops,
    finish,
    get rows() {
      return rows;
    },
    set rows(value) {
      rows = value;
    },
    get observes() {
      return observes;
    },
    start: () =>
      owner.start({
        registeredIntent: {
          id: 'EXAMPLE-intent',
          generation: 'EXAMPLE-generation',
        },
        spawn: () => child,
      }),
  };
}
test('owned tree is repeatedly verified, descendants signal first, close is single-flight', async () => {
  const f = fixture();
  assert.equal((await f.start()).allowed, true);
  assert.equal(f.owner.live(), true);
  const a = f.owner.close({ turnCompleted: true }),
    b = f.owner.close({ turnCompleted: true });
  assert.equal(a, b);
  const result = await a;
  assert.equal(result.allowed, true);
  assert.equal(result.termination, 'forced-after-completed-turn');
  assert.equal(f.owner.live(), false);
  assert.deepEqual(
    f.signals.map((p) => p.pid),
    [f.leaf.pid, f.root.pid],
  );
  assert.ok(f.observes >= 6);
  assert.deepEqual(f.stops, []);
});
test('surviving child after parent and streams close blocks continuation', async () => {
  const f = fixture();
  f.backend.signal = async (p) => {
    f.signals.push(p);
    if (p.pid === f.root.pid) {
      f.rows = [f.leaf];
      f.finish();
    }
    return { verified: true, status: 'signalled' };
  };
  assert.equal((await f.start()).allowed, true);
  const result = await f.owner.close({ turnCompleted: true });
  assert.equal(f.owner.status().observation.exited, true);
  assert.equal(f.owner.status().observation.stderr, true);
  assert.equal(result.allowed, false);
  assert.equal(result.recoveryRequired, true);
  assert.equal(result.reason, 'PROCESS_SURVIVOR');
  assert.equal(
    (
      await f.owner.start({
        registeredIntent: { id: 'again', generation: 'next' },
        spawn: () => assert.fail('No restart'),
      })
    ).allowed,
    false,
  );
});
test('PID reuse before signalling stops without touching the recycled process', async () => {
  const f = fixture();
  assert.equal((await f.start()).allowed, true);
  f.rows = [f.root, { ...f.leaf, created: '999' }];
  assert.equal((await f.owner.close({ turnCompleted: true })).allowed, false);
  assert.deepEqual(f.signals, []);
});
test('ownership is rechecked between descendant and parent signals', async () => {
  const f = fixture();
  f.backend.signal = async (p) => {
    f.signals.push(p);
    f.rows = [{ ...f.root, created: '999' }];
    return { verified: true, status: 'signalled' };
  };
  await f.start();
  assert.equal((await f.owner.close({ turnCompleted: true })).allowed, false);
  assert.deepEqual(
    f.signals.map((p) => p.pid),
    [f.leaf.pid],
  );
});
test('uncertain enumeration and inaccessible creation metadata refuse', async () => {
  for (const kind of ['incomplete', 'missing-created', 'reparented']) {
    const f = fixture();
    await f.start();
    if (kind === 'incomplete')
      f.backend.observe = async () => ({ complete: false, processes: f.rows });
    else
      f.rows = [
        f.root,
        {
          ...f.leaf,
          ...(kind === 'reparented' ? { parentPid: 123 } : { created: '' }),
        },
      ];
    assert.equal((await f.owner.close({ turnCompleted: true })).allowed, false);
    assert.deepEqual(f.signals, []);
  }
});
test('unexpected parent death is never a successful completed teardown', async () => {
  const f = fixture();
  await f.start();
  f.finish();
  f.rows = [];
  assert.equal((await f.owner.close({ turnCompleted: true })).allowed, false);
});
test('open stderr prevents clean release even after tree disappears', async () => {
  const f = fixture();
  f.backend.signal = async (p) => {
    f.rows = f.rows.filter((x) => x.pid !== p.pid);
    if (p.pid === f.root.pid) f.finish({ stderr: false });
    return { verified: true, status: 'signalled' };
  };
  await f.start();
  assert.equal(
    (await f.owner.close({ turnCompleted: true })).reason,
    'PROCESS_SETTLEMENT_INCOMPLETE',
  );
});
test('unfinished handler prevents release and retired generation cannot register more work', async () => {
  const f = fixture();
  await f.start();
  let resolve;
  const handler = f.owner.trackHandler(new Promise((r) => (resolve = r)));
  assert.equal((await f.owner.close({ turnCompleted: true })).allowed, false);
  assert.throws(
    () => f.owner.trackHandler(Promise.resolve()),
    /GENERATION_RETIRED/,
  );
  resolve();
  await handler;
  assert.equal((await f.owner.close({ turnCompleted: true })).allowed, false);
});
test('bounded timeout latches stop; late observations never signal or permit a successor', async () => {
  const f = fixture({ timeoutMs: 20 });
  await f.start();
  let resolve;
  f.backend.observe = () => new Promise((r) => (resolve = r));
  const result = await f.owner.close({ turnCompleted: true });
  assert.equal(result.reason, 'PROCESS_TIMEOUT');
  resolve({ complete: true, processes: [] });
  await Promise.resolve();
  assert.equal(f.owner.status().stopped, true);
  assert.deepEqual(f.signals, []);
});
test('new descendant observed during cleanup is included before clean settlement', async () => {
  const f = fixture();
  let added = false;
  const signal = f.backend.signal;
  f.backend.signal = async (p) => {
    const result = await signal(p);
    if (!added) {
      added = true;
      f.rows.push({ pid: 900003, parentPid: f.root.pid, created: '102' });
    }
    return result;
  };
  await f.start();
  // The intervening scan discovers this child while its parent is still live.
  assert.equal((await f.owner.close({ turnCompleted: true })).allowed, true);
  assert.ok(f.signals.some((p) => p.pid === 900003));
});
test('intent is required before spawn and unsupported modes never launch', async () => {
  assert.throws(
    () => createManagedProcess({ mode: false }),
    /MANAGED_MODE_REQUIRED/,
  );
  const f = fixture();
  assert.equal(
    (await f.owner.start({ spawn: () => assert.fail('No unregistered spawn') }))
      .allowed,
    false,
  );
});

test('S5 incomplete and failed turns clean all verified members without granting continuation', async () => {
  for (const kind of ['incomplete', 'error', 'unexpected']) {
    const f = fixture();
    await f.start();
    if (kind === 'error') f.child.emit('error', Error('EXAMPLE failure'));
    if (kind === 'unexpected') {
      f.finish();
      f.rows = [f.leaf];
    }
    const result = await f.owner.close({
      turnCompleted: kind !== 'incomplete',
    });
    assert.equal(result.allowed, false);
    assert.equal(result.recoveryRequired, true);
    assert.equal(result.cleanupObserved, true);
    assert.deepEqual(f.rows, []);
    assert.ok(f.signals.some((p) => p.pid === f.leaf.pid));
  }
});

test('S6 close has its own configurable total deadline across all observations', async () => {
  const f = fixture({ timeoutMs: 20, closeTimeoutMs: 200 });
  await f.start();
  const observe = f.backend.observe;
  f.backend.observe = async () => {
    await new Promise((r) => setTimeout(r, 10));
    return observe();
  };
  const start = performance.now();
  assert.equal((await f.owner.close({ turnCompleted: true })).allowed, true);
  assert.ok(performance.now() - start > 20);
  const short = fixture({ closeTimeoutMs: 20 });
  await short.start();
  short.backend.observe = async () => {
    await new Promise((r) => setTimeout(r, 60));
    return { complete: true, processes: [] };
  };
  const before = performance.now();
  assert.equal(
    (await short.owner.close({ turnCompleted: true })).reason,
    'PROCESS_TIMEOUT',
  );
  assert.ok(performance.now() - before < 100);
  assert.deepEqual(short.signals, []);
  assert.throws(() => fixture({ closeTimeoutMs: 0 }), /PROCESS_BOUNDS_INVALID/);
});

test('S5 stop callback reentering close joins the same cleanup promise', async () => {
  let f, reentered;
  f = fixture({
    onStop: () => {
      reentered = f.owner.close({ turnCompleted: false });
    },
  });
  await f.start();
  const first = f.owner.close({ turnCompleted: false });
  const result = await first;
  assert.equal(reentered, first);
  assert.equal(result.allowed, false);
  assert.equal(result.cleanupObserved, true);
  assert.deepEqual(
    f.signals.map((p) => p.pid),
    [f.leaf.pid, f.root.pid],
  );
});

const waitFor = async (predicate) => {
  const end = Date.now() + 1500;
  while (!predicate() && Date.now() < end)
    await new Promise((r) => setTimeout(r, 2));
  assert.ok(predicate(), 'bounded observation condition');
};
test('S10 two missing samples are tolerated; a successful sample resets the streak', async () => {
  const f = fixture({ monitorMs: 2, maxMonitorFailures: 2 });
  await f.start();
  const read = f.backend.observe;
  let failures = 2;
  f.backend.observe = () =>
    failures-- > 0 ? Promise.reject(Error('temporary')) : read();
  await waitFor(() => f.owner.status().monitor.successful >= 1);
  assert.equal(f.owner.live(), true);
  assert.equal(f.owner.status().monitor.failures, 2);
  assert.equal(f.owner.status().monitor.consecutiveFailures, 0);
  assert.equal((await f.owner.close({ turnCompleted: true })).allowed, true);
});
test('S10 a slow timed-out sample is tolerated, but the third consecutive failure stops', async () => {
  const f = fixture({
    monitorMs: 2,
    timeoutMs: 15,
    closeTimeoutMs: 100,
    monitorSlowMs: 10,
  });
  await f.start();
  const read = f.backend.observe;
  let count = 0;
  f.backend.observe = () =>
    ++count === 1
      ? new Promise((r) =>
          setTimeout(() => r({ complete: true, processes: f.rows }), 40),
        )
      : read();
  await waitFor(() => f.owner.status().monitor.successful >= 1);
  assert.equal(f.owner.live(), true);
  assert.equal(f.owner.status().monitor.failures, 1);
  assert.ok(f.owner.status().monitor.slow >= 1);
  f.backend.observe = async () => {
    throw Error('temporary');
  };
  await waitFor(() => f.owner.status().stopped);
  assert.equal(f.owner.status().monitor.consecutiveFailures, 3);
  f.backend.observe = read;
  assert.equal((await f.owner.close({ turnCompleted: true })).allowed, false);
  assert.deepEqual(f.rows, []);
});
test('S10 final close observation never receives monitor retry tolerance', async () => {
  const f = fixture({ maxMonitorFailures: 10 });
  await f.start();
  f.backend.observe = async () => ({ complete: false, processes: [] });
  assert.equal((await f.owner.close({ turnCompleted: true })).allowed, false);
  assert.equal(f.owner.status().monitor.attempts, 0);
  assert.deepEqual(f.signals, []);
});
test('S11 observed orphan may exit naturally or be cleaned, but a survivor still refuses', async () => {
  for (const fate of ['natural', 'cleanup', 'survivor']) {
    const f = fixture({ monitorMs: 2 });
    const middle = { pid: 900003, parentPid: f.root.pid, created: '101' },
      grandchild = { pid: 900004, parentPid: middle.pid, created: '102' };
    f.rows = [f.root, middle, grandchild];
    await f.start();
    f.rows = [f.root, grandchild];
    await waitFor(() => f.owner.status().monitor.transientOrphans === 1);
    assert.equal(f.owner.live(), true);
    if (fate === 'natural') f.rows = [f.root];
    if (fate === 'survivor') {
      const signal = f.backend.signal;
      f.backend.signal = (p) =>
        p.pid === grandchild.pid
          ? { verified: true, status: 'signalled' }
          : signal(p);
    }
    const result = await f.owner.close({ turnCompleted: true });
    assert.equal(result.allowed, fate !== 'survivor');
  }
});
test('an observed absent child loses authority over a later unrelated reuse of its PID', async () => {
  const f = fixture({ monitorMs: 2 });
  await f.start();
  f.rows = [f.root];
  await waitFor(() => f.owner.status().monitor.successful >= 1);
  f.rows = [f.root, { ...f.leaf, parentPid: 123, created: '999' }];
  await waitFor(() => f.owner.status().monitor.successful >= 2);
  assert.equal(f.owner.live(), true);
  assert.equal((await f.owner.close({ turnCompleted: true })).allowed, true);
  assert.deepEqual(
    f.signals.map((p) => p.pid),
    [f.root.pid],
  );
});
