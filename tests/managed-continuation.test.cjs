'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createContinuation,
} = require('../codex/runtime/managed-continuation.cjs');
test('continuation token rejects reuse even while its first attempt is pending', async () => {
  let attempts = 0,
    finish;
  const token = createContinuation(() => {
    attempts++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const first = token.consume();
  // A competing attempt must reject before it can replace the pending action.
  await assert.rejects(token.consume(), /MANAGED_CONTINUATION_SPENT/);
  assert.equal(attempts, 1);
  finish('accepted');
  assert.equal(await first, 'accepted');
  await assert.rejects(token.consume(), /MANAGED_CONTINUATION_SPENT/);
});
for (const fault of ['admission-refused', 'spawn-uncertain'])
  test('continuation spends before ' + fault, async () => {
    let attempts = 0;
    const token = createContinuation(async () => {
      attempts++;
      throw Error(fault);
    });
    await assert.rejects(token.consume(), new RegExp(fault));
    await assert.rejects(token.consume(), /MANAGED_CONTINUATION_SPENT/);
    assert.equal(attempts, 1);
    assert.equal(token.spent(), true);
  });
