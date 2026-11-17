'use strict';
// Controller-memory authority. No disk import/export or account/profile access.
const {inspectUsage, createBudget, checkBudget} = require('./queue-budget.cjs');
const live = new WeakMap();
const fail = code => { throw Object.assign(new Error(code), {code}); };
function createManagedRunBudget({mode, grant, bucket} = {}) {
  if (mode !== 'managed') fail('MANAGED_MODE_REQUIRED');
  const pinned = Object.freeze({runId: grant?.runId, absolute: grant?.absolute, relative: grant?.relative});
  try { createBudget({allowed: true, usedPercent: 0}, pinned); } catch { fail('BUDGET_REQUIRED'); }
  if (bucket !== undefined && (typeof bucket !== 'string' || !bucket.trim())) fail('BUDGET_BUCKET_INVALID');
  let state = null, stopped = false;
  const budget = Object.freeze({
    check(response, options) {
      if (stopped) return {allowed: false};
      try {
        if (!state) {
          const reading = inspectUsage(response, {...options, bucket});
          if (!reading.allowed) { stopped = true; return {allowed: false}; }
          state = createBudget(reading, pinned);
        }
        const checked = checkBudget(state, response, options);
        state = checked.budget || state;
        stopped ||= !checked.allowed;
        return {allowed: checked.allowed};
      } catch { stopped = true; return {allowed: false}; }
    },
    stop() { stopped = true; },
    stopped() { return stopped; },
    // Host-only snapshot for diagnostics. A snapshot is never accepted as authority.
    snapshot() { return state ? Object.freeze({...state, stopped}) : null; }
  });
  live.set(budget, {pinned, bucket});
  return budget;
}
function assertManagedRunBudget(budget, grant, bucket) {
  const record = live.get(budget);
  if (!record) fail('LIVE_RUN_BUDGET_REQUIRED');
  if (grant && ['runId','absolute','relative'].some(k => grant[k] !== record.pinned[k])) fail('RUN_BUDGET_GRANT_MISMATCH');
  if (bucket !== undefined && bucket !== (budget.snapshot()?.bucket ?? record.bucket)) fail('RUN_BUDGET_BUCKET_MISMATCH');
  return budget;
}
module.exports = {createManagedRunBudget, assertManagedRunBudget};
