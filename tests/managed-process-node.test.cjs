'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const {
  createManagedProcess,
  observeChild,
  bounded,
} = require('../codex/runtime/managed-process.cjs');
const {
  createWindowsTreeBackend,
} = require('../codex/runtime/managed-windows-tree.cjs');
const fixture = path.join(__dirname, 'fixtures', 'managed-node-stub.cjs');
test('real Node stub gate releases on owner EOF with observed process and stream closure', async () => {
  const child = spawn(
    process.execPath,
    [fixture, 'gate', 'EXAMPLE-' + crypto.randomUUID()],
    {
      windowsHide: true,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    },
  );
  const observation = observeChild(child);
  await bounded(
    () => new Promise((resolve) => child.stdout.once('data', resolve)),
    3000,
  );
  const closed = new Promise((resolve) => child.once('close', resolve));
  observation.requestClose();
  await bounded(() => closed, 3000);
  const s = observation.snapshot();
  assert.equal(s.exited, true);
  assert.equal(s.stdout, true);
  assert.equal(s.stderr, true);
  assert.equal(s.unexpected, false);
});
for (const survivor of [false, true])
  test(
    'real Windows observed Node tree ' +
      (survivor ? 'survivor refuses' : 'cleans up'),
    { skip: process.platform !== 'win32', timeout: 60000 },
    async (t) => {
      const osBackend = createWindowsTreeBackend({
        mode: 'managed',
        commandTimeoutMs: 5000,
      });
      const nonce = 'EXAMPLE-' + crypto.randomUUID();
      let root, leafPid, readyResolve;
      const ready = new Promise((resolve) => (readyResolve = resolve)),
        permitted = new Map();
      async function safeSignal(p) {
        // Independent test safety boundary. No production PID, arbitrary command or
        // unregistered process is ever forwarded to the signalling adapter.
        const known = permitted.get(p.pid);
        assert.ok(known, "Only this test's Node children may be signalled");
        assert.deepEqual(p, known);
        return osBackend.signal(p);
      }
      const backend = {
        observe: async () => {
          await ready;
          const view = await osBackend.observe();
          for (const p of view.processes)
            if (p.pid === root.pid || p.pid === leafPid) {
              const expectedParent =
                p.pid === root.pid ? process.pid : root.pid;
              assert.equal(p.parentPid, expectedParent);
              if (!permitted.has(p.pid)) permitted.set(p.pid, { ...p });
            }
          return view;
        },
        signal: async (p) => {
          if (survivor && p.pid === leafPid) {
            assert.deepEqual(p, permitted.get(p.pid));
            return { verified: true, status: 'signalled' };
          }
          return safeSignal(p);
        },
      };
      t.after(async () => {
        // Cleanup remains inside the independent allowlist; reuse is refused by the
        // real adapter's repeated creation/parent checks, never by PID alone.
        for (const p of [...permitted.values()].reverse()) await safeSignal(p);
      });
      const owner = createManagedProcess({
        mode: 'managed',
        backend,
        timeoutMs: 25000,
        pollMs: 10,
        maxRounds: 3,
        quietRounds: 2,
      });
      const start = await owner.start({
        registeredIntent: { id: nonce, generation: 'EXAMPLE' },
        spawn: () => {
          root = spawn(process.execPath, [fixture, 'root', nonce], {
            windowsHide: true,
            detached: true,
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          });
          root.on('message', (m) => {
            if (m?.nonce === nonce && Number.isSafeInteger(m.leafPid)) {
              leafPid = m.leafPid;
              readyResolve();
            }
          });
          return root;
        },
      });
      assert.equal(start.allowed, true, JSON.stringify(start));
      const result = await owner.close({ turnCompleted: true });
      assert.equal(result.allowed, !survivor, JSON.stringify(result));
      if (survivor) {
        assert.equal(result.reason, 'PROCESS_SURVIVOR');
        assert.equal(owner.status().observation.exited, true);
        assert.equal(owner.status().observation.stdout, true);
      }
    },
  );
