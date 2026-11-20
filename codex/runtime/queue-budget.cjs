'use strict';
// Receives full account/rateLimits/read responses, never sparse notifications.
const crypto = require('node:crypto');
const WEEK_MINUTES = 10080;
// Native quota readings have shown a one-second reset timestamp variation.
// Compare against the ORIGINAL anchor: never accumulate drift or renew a grant.
const RESET_VARIATION_SECONDS = 1;
function stop(reason) {
  return { allowed: false, reason };
}
function percent(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}
function inspectUsage(
  response,
  { bucket, observedAt, now = Date.now(), maxAgeMs = 60000 } = {},
) {
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(observedAt) ||
    !Number.isFinite(maxAgeMs) ||
    maxAgeMs <= 0 ||
    observedAt > now ||
    now - observedAt > maxAgeMs
  )
    return stop('stale-or-invalid-reading');
  if (!response || response.ordinaryUsageAllowed !== true)
    return stop('ordinary-usage-not-confirmed');
  // Account identity is carried only as a digest; account IDs never enter reports.
  if (typeof response.accountId !== 'string' || !response.accountId)
    return stop('account-identity-unavailable');
  const identity = crypto
    .createHash('sha256')
    .update(response.accountId)
    .digest('hex');
  const mapped = response.rateLimitsByLimitId;
  let selected, bucketId;
  if (mapped != null) {
    if (typeof mapped !== 'object' || Array.isArray(mapped))
      return stop('invalid-buckets');
    const keys = Object.keys(mapped);
    if (!bucket && keys.length !== 1) return stop('choose-usage-bucket');
    bucketId = bucket || keys[0];
    if (!Object.hasOwn(mapped, bucketId)) return stop('missing-usage-bucket');
    selected = mapped[bucketId];
  } else {
    selected = response.rateLimits;
    bucketId = selected?.limitId;
    if (!bucketId || (bucket && bucket !== bucketId))
      return stop('missing-usage-bucket');
  }
  if (!selected || typeof selected !== 'object')
    return stop('invalid-usage-bucket');
  if (selected.limitId != null && selected.limitId !== bucketId)
    return stop('inconsistent-usage-bucket');
  if (
    selected.rateLimitReachedType != null ||
    selected.spendControlReached === true
  )
    return stop('backend-usage-restriction');
  const spending = selected.individualLimit;
  if (
    spending != null &&
    (!percent(spending.remainingPercent) ||
      spending.remainingPercent <= 0 ||
      !Number.isSafeInteger(spending.resetsAt) ||
      spending.resetsAt * 1000 <= now)
  )
    return stop('spending-limit-unavailable-or-exhausted');
  const windows = [selected.primary, selected.secondary].filter(
    (w) => w != null,
  );
  if (!windows.length) return stop('missing-weekly-window');
  for (const w of windows) {
    if (
      !Number.isInteger(w.usedPercent) ||
      !percent(w.usedPercent) ||
      !Number.isSafeInteger(w.windowDurationMins) ||
      w.windowDurationMins <= 0 ||
      !Number.isSafeInteger(w.resetsAt) ||
      w.resetsAt * 1000 <= now
    )
      return stop('invalid-or-expired-window');
    if (w.usedPercent >= 100) return stop('usage-window-exhausted');
  }
  const weekly = windows.filter((w) => w.windowDurationMins === WEEK_MINUTES);
  if (weekly.length !== 1) return stop('missing-or-ambiguous-weekly-window');
  return {
    allowed: true,
    bucket: bucketId,
    accountDigest: identity,
    observedAt,
    usedPercent: weekly[0].usedPercent,
    resetsAt: weekly[0].resetsAt,
  };
}
function createBudget(reading, { runId, absolute, relative } = {}) {
  if (!reading?.allowed)
    throw Error('A fresh permitted weekly reading is required');
  if (typeof runId !== 'string' || !runId.trim())
    throw Error('A new run ID is required');
  if ((absolute === undefined) === (relative === undefined))
    throw Error('Specify exactly one current-run threshold');
  if (!percent(absolute === undefined ? relative : absolute))
    throw Error('Threshold must be between 0 and 100');
  const threshold =
    absolute === undefined ? reading.usedPercent + relative : absolute;
  if (!percent(threshold))
    throw Error('Relative budget exceeds the weekly limit');
  return {
    schema: 1,
    runId,
    bucket: reading.bucket,
    accountDigest: reading.accountDigest,
    resetsAt: reading.resetsAt,
    threshold,
    startPercent: reading.usedPercent,
    lastPercent: reading.usedPercent,
    observedAt: reading.observedAt,
    stopped: false,
  };
}
function checkBudget(budget, response, options = {}) {
  if (
    !budget ||
    budget.schema !== 1 ||
    !percent(budget.threshold) ||
    !percent(budget.lastPercent) ||
    !Number.isSafeInteger(budget.resetsAt) ||
    typeof budget.runId !== 'string'
  )
    return stop('invalid-run-budget');
  if (budget.stopped) return { ...stop('run-already-stopped'), budget };
  const reading = inspectUsage(response, { ...options, bucket: budget.bucket });
  let reason;
  if (!reading.allowed) reason = reading.reason;
  else if (reading.accountDigest !== budget.accountDigest)
    reason = 'account-changed';
  else if ((options.now ?? Date.now()) >= budget.resetsAt * 1000)
    reason = 'weekly-window-changed';
  else if (
    Math.abs(reading.resetsAt - budget.resetsAt) > RESET_VARIATION_SECONDS
  )
    reason = 'weekly-window-changed';
  else if (reading.observedAt < budget.observedAt)
    reason = 'out-of-order-reading';
  else if (reading.usedPercent < budget.lastPercent)
    reason = 'usage-decreased-recheck-run';
  else if (reading.usedPercent >= budget.threshold)
    reason = 'weekly-threshold-reached';
  const next = { ...budget, stopped: Boolean(reason) };
  if (reading.allowed) {
    next.lastPercent = reading.usedPercent;
    next.observedAt = reading.observedAt;
  }
  return {
    ...(reason ? stop(reason) : { allowed: true }),
    budget: next,
    reading,
  };
}
module.exports = { inspectUsage, createBudget, checkBudget };
