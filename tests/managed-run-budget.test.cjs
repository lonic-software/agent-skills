'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  createManagedAdmission,
  accountFingerprint,
} = require('../codex/runtime/managed-admission.cjs');
const {
  createManagedRunBudget,
} = require('../codex/runtime/managed-run-budget.cjs');
const stamp = 1800000000000,
  anchor = stamp / 1000 + 604800;
const instructions = {
  complete: true,
  scopeKey: 'EXAMPLE',
  sources: [{ key: 'host', identity: 'EXAMPLE', sha256: 'a'.repeat(64) }],
};
function observation(percent = 25, reset = anchor, multiple = false) {
  const selected = {
    limitId: 'codex',
    secondary: {
      usedPercent: percent,
      windowDurationMins: 10080,
      resetsAt: reset,
    },
  };
  return {
    account: {
      account: { type: 'chatgpt' },
      workspaceRouting: {
        chatgptAccountId: 'EXAMPLE',
        backendOrigin: 'https://example.invalid',
      },
    },
    usage: {
      accountId: 'EXAMPLE',
      ordinaryUsageAllowed: true,
      ...(multiple
        ? {
            rateLimitsByLimitId: {
              other: { ...selected, limitId: 'other' },
              codex: selected,
            },
          }
        : { rateLimits: selected }),
    },
    observedAt: stamp,
    effective: { model: 'EXAMPLE', provider: 'EXAMPLE', effort: 'EXAMPLE' },
    instructions,
    hooks: {
      complete: true,
      scope: 'cwd',
      errors: [],
      warnings: [],
      hooks: [],
    },
  };
}
function options(extra = {}) {
  const s = observation();
  return {
    mode: 'managed',
    enrollment: {
      schema: 1,
      algorithm: 'm2-account-v1',
      fingerprint: accountFingerprint(s.account, s.usage),
    },
    selection: s.effective,
    instructions,
    budget: { runId: 'EXAMPLE-run', relative: 10 },
    now: () => stamp,
    ...extra,
  };
}
function admit(guard, s = observation()) {
  guard.initialAccountRead();
  return guard.sample('before-thread', s);
}
test('S1 second admission keeps original threshold and reset anchor; relative grant never reanchors', () => {
  const first = createManagedAdmission(options());
  assert.equal(admit(first).allowed, true);
  const shared = first.runBudget;
  const initial = shared.snapshot();
  const second = createManagedAdmission(options({ runBudget: shared }));
  assert.equal(admit(second, observation(30, anchor + 1)).allowed, true);
  const carried = second.runBudget.snapshot();
  assert.equal(carried.threshold, initial.threshold);
  assert.equal(carried.threshold, 35);
  assert.equal(carried.resetsAt, anchor);
  assert.equal(carried.startPercent, 25);
  assert.equal(second.runBudget, shared);
  const third = createManagedAdmission(options({ runBudget: shared }));
  assert.equal(admit(third, observation(35)).allowed, false);
});
test('S1 reset between admission instances stops instead of issuing a new weekly grant', () => {
  const first = createManagedAdmission(options());
  assert.equal(admit(first).allowed, true);
  const next = createManagedAdmission(options({ runBudget: first.runBudget }));
  assert.equal(admit(next, observation(26, anchor + 604800)).allowed, false);
  assert.equal(next.status().reason, 'USAGE_NOT_ADMISSIBLE');
  assert.equal(first.runBudget.stopped(), true);
});
test('S1 lower usage, stale ordering and a stopped shared grant cannot be restored', () => {
  for (const variant of ['lower', 'order', 'stopped']) {
    const first = createManagedAdmission(options());
    assert.equal(admit(first).allowed, true);
    if (variant === 'stopped') first.stop('operator-cancelled');
    const next = createManagedAdmission(
      options({ runBudget: first.runBudget }),
    );
    const s = observation(variant === 'lower' ? 24 : 26);
    if (variant === 'order') s.observedAt--;
    assert.equal(admit(next, s).allowed, false);
  }
});
test('S1 controller can initialize authority before either admission; snapshots cannot become authority', () => {
  const opts = options(),
    shared = createManagedRunBudget({ mode: 'managed', grant: opts.budget });
  assert.equal(
    shared.check(observation().usage, { now: stamp, observedAt: stamp })
      .allowed,
    true,
  );
  const guard = createManagedAdmission({ ...opts, runBudget: shared });
  assert.equal(admit(guard, observation(30)).allowed, true);
  assert.throws(
    () => createManagedAdmission({ ...opts, runBudget: shared.snapshot() }),
    /LIVE_RUN_BUDGET_REQUIRED/,
  );
  assert.throws(
    () =>
      createManagedAdmission({
        ...opts,
        runBudget: shared,
        budget: { runId: 'OTHER', relative: 10 },
      }),
    /RUN_BUDGET_GRANT_MISMATCH/,
  );
  assert.equal(Object.isFrozen(shared.snapshot()), true);
});
test('S2 explicit bucket is forwarded exactly like queue and retained by the successor', () => {
  const first = createManagedAdmission(options({ bucket: 'codex' }));
  assert.equal(admit(first, observation(25, anchor, true)).allowed, true);
  const second = createManagedAdmission(
    options({ runBudget: first.runBudget }),
  );
  assert.equal(admit(second, observation(30, anchor, true)).allowed, true);
  assert.equal(second.runBudget.snapshot().bucket, 'codex');
  assert.throws(
    () =>
      createManagedAdmission(
        options({ runBudget: first.runBudget, bucket: 'other' }),
      ),
    /RUN_BUDGET_BUCKET_MISMATCH/,
  );
});
test('S2 missing or unknown bucket still refuses multiple categories', () => {
  for (const bucket of [undefined, 'missing']) {
    const guard = createManagedAdmission(options({ bucket }));
    assert.equal(admit(guard, observation(25, anchor, true)).allowed, false);
  }
});
