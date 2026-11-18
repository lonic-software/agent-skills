'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  createWindowsPolicyCheck,
  windowsPowerShellEnv,
  BLOCKED,
  MESSAGE,
} = require('../codex/runtime/managed-windows-policy.cjs');
const {
  createManagedProcess,
} = require('../codex/runtime/managed-process.cjs');
const {
  createWindowsGateAdapter,
} = require('../codex/runtime/managed-windows-gate.cjs');
const { createManagedGate } = require('../codex/runtime/managed-gate.cjs');
function policy(value) {
  return createWindowsPolicyCheck({
    execute: (file, args, options, done) => {
      assert.deepEqual(args, [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-ExecutionPolicy',
      ]);
      done(null, value);
    },
  });
}
test('S7 Restricted, AllSigned and unknown policy fail with fixed readable diagnostic', async () => {
  for (const value of ['Restricted', 'AllSigned', 'SECRET', 'Bypass', ''])
    await assert.rejects(
      policy(value)(),
      (e) => e.code === BLOCKED && e.message === MESSAGE,
    );
  for (const value of ['RemoteSigned', 'Unrestricted'])
    assert.equal((await policy(value)()).allowed, true);
});
test('S7 policy preflight refuses before author spawn', async () => {
  let spawns = 0,
    observations = 0;
  const owner = createManagedProcess({
    mode: 'managed',
    backend: {
      prepare: policy('Restricted'),
      observe: async () => {
        observations++;
      },
      signal: async () => assert.fail('No signal'),
    },
  });
  const result = await owner.start({
    registeredIntent: { id: 'EXAMPLE', generation: 'EXAMPLE' },
    spawn: () => spawns++,
  });
  assert.equal(result.reason, BLOCKED);
  assert.equal(result.diagnostic, MESSAGE);
  assert.equal(spawns, 0);
  assert.equal(observations, 0);
});
test(
  'S7 gate refuses before helper spawn or filesystem observation',
  { skip: process.platform !== 'win32' },
  async () => {
    let spawns = 0,
      observations = 0;
    const gate = createWindowsGateAdapter({
      mode: 'managed',
      gatePath: 'EXAMPLE-must-not-open',
      adapters: {
        checkPolicy: policy('Restricted'),
        tree: { observe: async () => observations++ },
        spawnHelper: () => spawns++,
      },
    });
    await assert.rejects(
      gate.open({ expectedIdentity: {}, registeredIntent: { id: 'EXAMPLE' } }),
      (e) => e.code === BLOCKED,
    );
    assert.equal(spawns, 0);
    assert.equal(observations, 0);
    const owner = createManagedGate({
      mode: 'managed',
      adapter: gate,
      expectedIdentity: { key: 'EXAMPLE', identity: 'EXAMPLE' },
      registeredIntent: { id: 'EXAMPLE' },
    });
    const result = await owner.acquire();
    assert.equal(result.reason, BLOCKED);
    assert.equal(result.diagnostic, MESSAGE);
    assert.equal(spawns, 0);
  },
);
test('S7 failed policy read is sanitized and never invokes a script fallback', async () => {
  let calls = 0;
  const check = createWindowsPolicyCheck({
    execute: (f, a, o, done) => {
      calls++;
      done(Error('SECRET'));
    },
  });
  await assert.rejects(
    check(),
    (e) =>
      e.code === 'MANAGED_POWERSHELL_POLICY_UNAVAILABLE' &&
      !e.message.includes('SECRET'),
  );
  assert.equal(calls, 1);
});
test('Windows helper module-path normalization preserves policy and parent environment', () => {
  const before = { ...process.env },
    env = windowsPowerShellEnv();
  assert.equal(
    JSON.stringify({ ...process.env }) === JSON.stringify(before),
    true,
    'parent environment unchanged',
  );
  for (const [key, value] of Object.entries(before))
    if (key.toLowerCase() === 'psmodulepath')
      assert.equal(env[key] === undefined, true);
    else
      assert.equal(
        env[key] === value,
        true,
        'non-module-path variable preserved',
      );
});
