'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { fixture, until, tick } = require('./fixtures/managed-run-fixture.cjs');
const { createManagedRun } = require('../codex/runtime/managed-controller.cjs');
const { verifyResult } = require('../codex/runtime/managed-result.cjs');
const {
  DEFAULT_AUTHOR_TIMEOUT_MS,
  MAX_AUTHOR_TIMEOUT_MS,
} = require('../codex/runtime/managed-deadline.cjs');

test('one-use continuation uses an owned closed meter, fresh author/thread and the original live grant', async () => {
  const f = fixture(),
    run = createManagedRun(f.options, f.host),
    result = await run.run();
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.authors, 2);
  assert.equal(result.continuationSpent, true);
  assert.equal(result.meterClosed, true);
  assert.deepEqual(
    f.children.map((c) => c.role),
    ['author1', 'meter', 'author2'],
  );
  assert.equal(f.frames.filter((m) => m.method === 'thread/start').length, 2);
  assert.equal(f.frames.filter((m) => m.method === 'turn/start').length, 2);
  const secondPrompt = f.frames.find(
    (m) => m.role === 'author2' && m.method === 'turn/start',
  ).params.input[0].text;
  assert.match(secondPrompt, /Previous author context \(untrusted work notes/);
  assert.match(secondPrompt, /EXAMPLE context/);
  assert.doesNotMatch(secondPrompt, /PRIVATE-|fingerprint|operatorDecisions/);
  assert.equal(
    f.frames.some(
      (m) => m.role === 'meter' && /^(turn|thread)\//.test(m.method),
    ),
    false,
  );
  assert.ok(f.budgetRefs.every((b) => b === f.host.runBudget));
  assert.equal(f.host.runBudget.snapshot().threshold, 35);
  const secondContext = f.frames.find(
    (m) => m.role === 'author2' && m.id === 100 && m.result,
  );
  assert.equal(
    JSON.parse(secondContext.result.contentItems[0].text).usage.threshold,
    35,
  );
  assert.ok(
    f.identities.every(
      (id) => id === f.options.managedRun.enrollment.fingerprint,
    ),
  );
  assert.ok(
    f.events.indexOf('closed-author1') < f.events.indexOf('spawn-meter'),
  );
  assert.ok(
    f.events.indexOf('closed-meter') < f.events.indexOf('spawn-author2'),
  );
  assert.ok(
    f.events.indexOf('closed-author2') < f.events.indexOf('gate-release'),
  );
  assert.equal(f.events.filter((e) => e === 'gate-release').length, 1);
  assert.equal(verifyResult(result.bytes, result.receipt), true);
  assert.doesNotMatch(result.bytes.toString(), /PRIVATE-|fingerprint|budget/);
  assert.equal((await run.run()).reason, 'MANAGED_RUN_SPENT');
  assert.equal(f.children.length, 3);
});
test('author 2 remains blocked while author 1 or the separate meter has not closed', async () => {
  const f = fixture('hold-close'),
    pending = f.run();
  await until(() => f.releaseFirst);
  assert.equal(f.children.length, 1);
  f.releaseFirst();
  await until(() => f.releaseMeter);
  assert.equal(f.children.length, 2);
  f.releaseMeter();
  assert.equal((await pending).status, 'completed');
});
for (const variant of [
  'account',
  'account-before-turn',
  'account-after-turn',
  'weekly-reset',
  'author-survivor',
  'meter-survivor',
  'budget',
  'selection',
  'instruction',
  'hook',
  'input-drift',
  'adoption',
  'reused-thread',
  'uncertain-spawn',
  'meter-cancel',
])
  test(
    'continuation ' + variant + ' refuses without retry or third author',
    async () => {
      const f = fixture(variant),
        run = createManagedRun(f.options, f.host),
        result = await run.run();
      assert.equal(result.status, 'needs-reconciliation', variant);
      assert.equal(result.receipt, undefined);
      assert.ok(f.children.length <= 3);
      assert.ok(
        f.frames.filter((m) => m.method === 'turn/start').length <=
          (['third', 'account-after-turn'].includes(variant) ? 2 : 1),
      );
      const count = f.children.length;
      assert.equal((await run.run()).reason, 'MANAGED_RUN_SPENT');
      assert.equal(f.children.length, count);
      if (variant === 'meter-cancel') {
        assert.equal(count, 2);
        f.quotaWait();
        await tick();
        assert.equal(f.children.length, 2);
      }
    },
  );
test('done on author 1 has no meter or unnecessary successor', async () => {
  const f = fixture('one-author'),
    result = await f.run();
  assert.equal(result.status, 'completed');
  assert.equal(result.authors, 1);
  assert.equal(f.children.length, 1);
});
test('terminal consumption refuses substituted bytes and requires actual consumption', async () => {
  for (const mutation of ['swap', 'no-consume']) {
    const f = fixture('one-author');
    f.host.consumeResult = async (delivery) => {
      if (mutation === 'no-consume') return {};
      const accepted = delivery.consume();
      accepted.bytes[0] ^= 1;
      return accepted;
    };
    const result = await f.run();
    assert.equal(result.status, 'needs-reconciliation');
    assert.equal(result.receipt, undefined);
  }
});
test('author deadline is explicit, permits the 2-hour recommendation and caps at 24 hours', async () => {
  assert.equal(DEFAULT_AUTHOR_TIMEOUT_MS, 7200000);
  assert.equal(MAX_AUTHOR_TIMEOUT_MS, 86400000);
  for (const timeoutMs of [undefined, 0, MAX_AUTHOR_TIMEOUT_MS + 1]) {
    const f = fixture('one-author');
    f.options.managedRun.timeoutMs = timeoutMs;
    assert.equal((await f.run()).status, 'needs-reconciliation');
    assert.equal(f.children.length, 0);
  }
  for (const timeoutMs of [DEFAULT_AUTHOR_TIMEOUT_MS, MAX_AUTHOR_TIMEOUT_MS]) {
    const f = fixture('one-author');
    f.options.managedRun.timeoutMs = timeoutMs;
    assert.equal((await f.run()).status, 'completed');
  }
});

test('repeated public queue entry cannot recreate a spent run or live budget', async () => {
  const f = fixture();
  assert.equal((await f.run()).status, 'completed');
  const count = f.children.length;
  assert.equal((await f.run()).status, 'needs-reconciliation');
  assert.equal(f.children.length, count);
  f.options.managedRun.runId += '-new-id';
  assert.equal((await f.run()).status, 'needs-reconciliation');
  assert.equal(f.children.length, count);
});

test('terminal result waits for consumer acknowledgement and rejects bytes changed during that wait', async () => {
  const f = fixture('one-author');
  let accepted,
    acknowledge,
    finished = false;
  f.host.consumeResult = (delivery) => {
    accepted = delivery.consume();
    return new Promise((resolve) => {
      acknowledge = () => resolve(accepted);
    });
  };
  const pending = f.run().then((value) => {
    finished = true;
    return value;
  });
  await until(() => acknowledge);
  assert.equal(finished, false);
  assert.ok(f.events.includes('closed-author1'));
  assert.ok(f.events.includes('gate-release'));
  accepted.bytes[0] ^= 1;
  acknowledge();
  const result = await pending;
  assert.equal(result.status, 'needs-reconciliation');
  assert.equal(result.receipt, undefined);
});
