'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  inspectUsage,
  createBudget,
  checkBudget,
} = require('../codex/runtime/queue-budget.cjs');
const now = 1800000000000,
  reset = now / 1000 + 86400;
function response(weekly = 25) {
  return {
    accountId: 'EXAMPLE-ACCOUNT',
    ordinaryUsageAllowed: true,
    rateLimits: {},
    rateLimitsByLimitId: {
      codex: {
        limitId: 'codex',
        primary: {
          windowDurationMins: 300,
          usedPercent: 10,
          resetsAt: reset - 1000,
        },
        secondary: {
          windowDurationMins: 10080,
          usedPercent: weekly,
          resetsAt: reset,
        },
      },
    },
  };
}
const options = { observedAt: now, now };
const fresh = (r) => inspectUsage(r, options);
const budget = () =>
  createBudget(fresh(response()), { runId: 'EXAMPLE-RUN', relative: 10 });
test('weekly window is selected by duration, including a swapped primary', () => {
  const r = response(),
    b = r.rateLimitsByLimitId.codex;
  [b.primary, b.secondary] = [b.secondary, b.primary];
  assert.equal(fresh(r).usedPercent, 25);
  assert.equal(JSON.stringify(fresh(r)).includes('EXAMPLE-ACCOUNT'), false);
});
test('missing, short-only, expired, future, stale and ambiguous readings stop', () => {
  assert.equal(
    inspectUsage(response(), { ...options, observedAt: now - 60001 }).allowed,
    false,
  );
  assert.equal(
    inspectUsage(response(), { ...options, observedAt: now + 1 }).allowed,
    false,
  );
  for (const mutate of [
    (r) => delete r.accountId,
    (r) => {
      r.rateLimitsByLimitId.codex.secondary = null;
    },
    (r) => {
      r.rateLimitsByLimitId.codex.secondary.resetsAt = now / 1000;
    },
    (r) => {
      r.rateLimitsByLimitId.codex.primary.windowDurationMins = 10080;
    },
    (r) => {
      r.rateLimitsByLimitId.extra = r.rateLimitsByLimitId.codex;
    },
  ]) {
    const r = response();
    mutate(r);
    assert.equal(fresh(r).allowed, false);
  }
});
test('bucket selection is explicit and does not fall back to a stale legacy view', () => {
  const r = response();
  r.rateLimitsByLimitId.other = {
    ...r.rateLimitsByLimitId.codex,
    limitId: 'other',
  };
  assert.equal(inspectUsage(r, { ...options, bucket: 'codex' }).allowed, true);
  assert.equal(
    inspectUsage(r, { ...options, bucket: 'missing' }).allowed,
    false,
  );
  r.rateLimitsByLimitId = {};
  r.rateLimits = { limitId: 'codex' };
  assert.equal(fresh(r).allowed, false);
});
test('relative threshold is converted once and equality stops the run', () => {
  const b = budget();
  assert.equal(b.threshold, 35);
  const next = checkBudget(b, response(30), options);
  assert.equal(next.allowed, true);
  assert.equal(next.budget.threshold, 35);
  const end = checkBudget(next.budget, response(35), options);
  assert.equal(end.reason, 'weekly-threshold-reached');
  assert.equal(
    checkBudget(end.budget, response(20), options).reason,
    'run-already-stopped',
  );
});
test('new budget needs explicit current-run threshold and identity', () => {
  for (const args of [
    { runId: 'x' },
    { runId: 'x', absolute: 20, relative: 10 },
    { absolute: 20 },
    { runId: 'x', relative: 90 },
    { runId: 'x', absolute: NaN },
  ])
    assert.throws(() => createBudget(fresh(response()), args));
});
test('short quota and backend restrictions stop before chaining', () => {
  for (const mutate of [
    (r) => {
      r.ordinaryUsageAllowed = false;
    },
    (r) => {
      r.ordinaryUsageAllowed = null;
    },
    (r) => {
      r.rateLimitsByLimitId.codex.primary.usedPercent = 100;
    },
    (r) => {
      r.rateLimitsByLimitId.codex.spendControlReached = true;
    },
    (r) => {
      r.rateLimitsByLimitId.codex.rateLimitReachedType = 'rate_limit_reached';
    },
    (r) => {
      r.rateLimitsByLimitId.codex.individualLimit = {
        remainingPercent: 0,
        resetsAt: reset,
      };
    },
  ]) {
    const r = response();
    mutate(r);
    assert.equal(checkBudget(budget(), r, options).allowed, false);
  }
});
test('account change, reset and decreasing usage require a new run decision', () => {
  const r = response();
  r.accountId = 'EXAMPLE-OTHER';
  assert.equal(checkBudget(budget(), r, options).reason, 'account-changed');
  const resetResponse = response(1);
  resetResponse.rateLimitsByLimitId.codex.secondary.resetsAt += 604800;
  assert.equal(
    checkBudget(budget(), resetResponse, options).reason,
    'weekly-window-changed',
  );
  assert.equal(
    checkBudget(budget(), response(24), options).reason,
    'usage-decreased-recheck-run',
  );
});
test('invalid numeric fields and unavailable timing never grant permission', () => {
  for (const value of [NaN, Infinity, -1, 101, '25', 1.5]) {
    const r = response(value);
    assert.equal(fresh(r).allowed, false);
  }
  const r = response();
  r.rateLimitsByLimitId.codex.secondary.resetsAt = null;
  assert.equal(fresh(r).allowed, false);
  assert.equal(inspectUsage(response(), { now }).allowed, false);
});

test('one-second reset variation keeps the original anchor and ceiling', () => {
  let b = budget();
  for (const shift of [1, -1, 1, 0]) {
    const r = response(30);
    r.rateLimitsByLimitId.codex.secondary.resetsAt += shift;
    const next = checkBudget(b, r, options);
    assert.equal(next.allowed, true);
    assert.equal(next.budget.resetsAt, reset);
    assert.equal(next.budget.threshold, 35);
    assert.equal(next.budget.startPercent, 25);
    b = next.budget;
  }
  const r = response(30);
  r.rateLimitsByLimitId.codex.secondary.resetsAt += 2;
  assert.equal(checkBudget(b, r, options).reason, 'weekly-window-changed');
});

test('larger reset changes in either direction stop without extending the grant', () => {
  for (const shift of [-2, 2, 604800]) {
    const r = response(30);
    r.rateLimitsByLimitId.codex.secondary.resetsAt += shift;
    const end = checkBudget(budget(), r, options);
    assert.equal(end.reason, 'weekly-window-changed');
    assert.equal(end.budget.resetsAt, reset);
    assert.equal(
      checkBudget(end.budget, response(30), options).reason,
      'run-already-stopped',
    );
  }
});

test('timestamp variation cannot pass the original expiry', () => {
  const r = response(30);
  r.rateLimitsByLimitId.codex.primary = null;
  r.rateLimitsByLimitId.codex.secondary.resetsAt = reset + 1;
  const nearReset = { now: reset * 1000, observedAt: reset * 1000 };
  assert.equal(
    checkBudget(budget(), r, nearReset).reason,
    'weekly-window-changed',
  );
});

test('timestamp variation does not weaken threshold, identity or decrease checks', () => {
  for (const [used, account, reason] of [
    [35, 'EXAMPLE-ACCOUNT', 'weekly-threshold-reached'],
    [24, 'EXAMPLE-ACCOUNT', 'usage-decreased-recheck-run'],
    [30, 'EXAMPLE-OTHER', 'account-changed'],
  ]) {
    const r = response(used);
    r.accountId = account;
    r.rateLimitsByLimitId.codex.secondary.resetsAt += 1;
    assert.equal(checkBudget(budget(), r, options).reason, reason);
  }
});

test('invalid persisted reset anchors cannot grant permission', () => {
  for (const resetsAt of [
    null,
    undefined,
    NaN,
    Infinity,
    '1800086400',
    1800086400.5,
  ]) {
    assert.equal(
      checkBudget({ ...budget(), resetsAt }, response(), options).reason,
      'invalid-run-budget',
    );
  }
});
