'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { spawn } = require('node:child_process');
const {
  createWindowsGateAdapter,
  gateIdentity,
} = require('../codex/runtime/managed-windows-gate.cjs');
const { createManagedGate } = require('../codex/runtime/managed-gate.cjs');
const { bounded } = require('../codex/runtime/managed-process.cjs');
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-heartbeat-')),
    file = path.join(dir, 'gate.lock');
  fs.writeFileSync(file, 'EXAMPLE');
  let child,
    forward,
    seen,
    pings = 0;
  const pending = new Promise((r) => (seen = r)),
    stops = [];
  const adapter = createWindowsGateAdapter({
    mode: 'managed',
    gatePath: file,
    timeoutMs: 900,
    adapters: {
      checkPolicy: async () => ({ allowed: true }),
      tree: {
        observe: async () => ({
          complete: true,
          processes: [
            { pid: process.pid, parentPid: 0, created: '10' },
            ...(child && child.exitCode === null
              ? [{ pid: child.pid, parentPid: process.pid, created: '11' }]
              : []),
          ],
        }),
      },
      spawnHelper: () => {
        child = spawn(
          process.execPath,
          [
            path.join(__dirname, 'fixtures/managed-node-stub.cjs'),
            'gate-protocol',
            'EXAMPLE-heartbeat',
          ],
          {
            windowsHide: true,
            detached: true,
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        const write = child.stdin.write.bind(child.stdin);
        child.stdin.write = (bytes, ...rest) => {
          if (String(bytes) === 'ping\n') {
            pings++;
            forward = () => write(bytes, ...rest);
            seen();
            return true;
          }
          return write(bytes, ...rest);
        };
        return child;
      },
    },
  });
  t.after(async () => {
    await adapter.abandon();
    assert.equal(
      path.dirname(fs.realpathSync(dir)),
      fs.realpathSync(os.tmpdir()),
    );
    fs.rmSync(dir, { recursive: true });
  });
  const gate = createManagedGate({
    mode: 'managed',
    expectedIdentity: gateIdentity(file),
    registeredIntent: { id: 'EXAMPLE' },
    adapter,
    timeoutMs: 2000,
    onStop: (c) => stops.push(c),
  });
  assert.equal((await gate.acquire()).allowed, true);
  await bounded(() => pending, 2000);
  return {
    gate,
    stops,
    forward: () => forward(),
    get pings() {
      return pings;
    },
  };
}
for (const operation of ['check', 'release'])
  test(
    'S22 ' + operation + ' joins an in-flight heartbeat without extra requests',
    { skip: process.platform !== 'win32', timeout: 8000 },
    async (t) => {
      const f = await fixture(t),
        start = performance.now(),
        result = f.gate[operation]();
      setTimeout(f.forward, 50);
      const closed = await result;
      t.diagnostic(
        JSON.stringify({
          operation,
          elapsedMs: performance.now() - start,
          pings: f.pings,
          result: closed,
        }),
      );
      assert.equal(closed.allowed, true);
      assert.deepEqual(f.stops, []);
      assert.equal(f.pings, 1);
      if (operation === 'check')
        assert.equal((await f.gate.release()).allowed, true);
    },
  );
for (const operation of ['check', 'release'])
  test(
    'S22 ' + operation + ' still refuses an unacknowledged heartbeat',
    { skip: process.platform !== 'win32', timeout: 8000 },
    async (t) => {
      const f = await fixture(t),
        start = performance.now(),
        result = await f.gate[operation]();
      assert.equal(result.allowed, false);
      assert.equal(result.recoveryRequired, true);
      assert.ok(f.stops.length);
      assert.equal(f.pings, 1);
      t.diagnostic(
        JSON.stringify({
          operation,
          elapsedMs: performance.now() - start,
          pings: f.pings,
          result,
        }),
      );
    },
  );
