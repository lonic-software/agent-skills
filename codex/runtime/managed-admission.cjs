'use strict';
// Step-1 policy core only. No filesystem, profile, native process or CLI access.
// Not connected to legacy queue entry points. Host adapters must establish the
// completeness of normalized inventories; this module cannot discover it.
const crypto = require('node:crypto');
const {
  createManagedRunBudget,
  assertManagedRunBudget,
} = require('./managed-run-budget.cjs');
const ALGORITHM = 'm2-account-v1';
const sha256 = (value) =>
  crypto.createHash('sha256').update(value).digest('hex');
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const hash = (value) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const error = (code) => Object.assign(new Error(code), { code });
const yes = () => ({ allowed: true });
const no = (reason) => ({ allowed: false, reason });
const terminalLabel = (value) =>
  JSON.stringify(value).replace(
    /[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );

function accountFingerprint(account, usage) {
  const routing = account?.workspaceRouting?.chatgptAccountId;
  const id = usage?.accountId;
  const type = account?.account?.type;
  const origin = account?.workspaceRouting?.backendOrigin;
  if (![routing, id, type, origin].every(text) || routing !== id)
    throw error('ACCOUNT_IDENTITY_INVALID');
  // Alphabetical keys match the saved M2 canonical encoding, without importing
  // the probe (whose module-level setup can access a real profile).
  return sha256(
    JSON.stringify({
      accountType: type,
      backendOrigin: origin,
      routingAccountId: routing,
      usageAccountId: id,
    }),
  );
}

async function enrollAccount({ terminal, readSample, save } = {}) {
  if (
    terminal?.inputTTY !== true ||
    terminal?.outputTTY !== true ||
    typeof terminal.confirm !== 'function'
  )
    throw error('INTERACTIVE_TERMINAL_REQUIRED');
  if (typeof readSample !== 'function' || typeof save !== 'function')
    throw error('ENROLLMENT_ADAPTER_REQUIRED');
  try {
    const first = await readSample();
    const fingerprint = accountFingerprint(first?.account, first?.usage);
    const email = first?.account?.account?.email;
    if (!text(email) || email.length > 320) throw error('ENROLLMENT_FAILED');
    // JSON escaping prevents terminal control sequences. Only the dedicated TTY
    // adapter may receive this prompt; never pass it to ordinary logging.
    const label = terminalLabel(email);
    const confirmation = await terminal.confirm(
      'Approve account ' + label + '? Type yes to store only its fingerprint: ',
    );
    if (confirmation !== 'yes') throw error('ENROLLMENT_FAILED');
    const second = await readSample();
    if (accountFingerprint(second?.account, second?.usage) !== fingerprint)
      throw error('ENROLLMENT_FAILED');
    const record = Object.freeze({
      schema: 1,
      algorithm: ALGORITHM,
      fingerprint,
    });
    await save(record);
    return record;
  } catch {
    // Do not retain account-bearing transport, terminal or persistence errors.
    throw error('ENROLLMENT_FAILED');
  }
}

function instructionDigest(inventory) {
  if (
    inventory?.complete !== true ||
    !text(inventory.scopeKey) ||
    !Array.isArray(inventory.sources) ||
    !inventory.sources.length
  )
    throw error('INSTRUCTIONS_CHANGED');
  const keys = new Set();
  const rows = inventory.sources
    .map((source) => {
      if (
        !text(source?.key) ||
        !text(source.identity) ||
        !hash(source.sha256) ||
        keys.has(source.key)
      )
        throw error('INSTRUCTIONS_CHANGED');
      keys.add(source.key);
      return [source.key, source.identity, source.sha256];
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256(JSON.stringify([inventory.scopeKey, rows]));
}
function hooksAdmissible(inventory, scope) {
  return (
    inventory?.complete === true &&
    inventory.scope === scope &&
    Array.isArray(inventory.errors) &&
    inventory.errors.length === 0 &&
    Array.isArray(inventory.warnings) &&
    inventory.warnings.length === 0 &&
    Array.isArray(inventory.hooks) &&
    inventory.hooks.every((h) => h?.known === true && h.enabled === false)
  );
}

function createManagedAdmission(options = {}) {
  if (options.mode !== 'managed') throw error('MANAGED_MODE_REQUIRED');
  const enrollment = options.enrollment;
  if (
    enrollment?.schema !== 1 ||
    enrollment.algorithm !== ALGORITHM ||
    !hash(enrollment.fingerprint)
  )
    throw error('ENROLLMENT_REQUIRED');
  // Inputs are private host-approved data, not model parameters. Copy scalars;
  // later edits to an input object cannot rebaseline this generation.
  const expectedFingerprint = enrollment.fingerprint;
  const selection = Object.freeze({
    model: options.selection?.model,
    provider: options.selection?.provider,
    effort: options.selection?.effort,
  });
  if (!Object.values(selection).every(text)) throw error('SELECTION_REQUIRED');
  const expectedInstructions = instructionDigest(options.instructions);
  // Reuse the controller's live run authority across meters and author generations.
  // Only the first instance may create it; successors receive this same object.
  const runBudget =
    options.runBudget === undefined
      ? createManagedRunBudget({
          mode: options.mode,
          grant: options.budget,
          bucket: options.bucket,
        })
      : assertManagedRunBudget(
          options.runBudget,
          options.budget,
          options.bucket,
        );
  const now = options.now || Date.now;
  const onInterrupt = options.onInterrupt || (() => {});
  if (typeof now !== 'function' || typeof onInterrupt !== 'function')
    throw error('ADAPTER_INVALID');
  let phase = 'startup',
    startupUpdates = 0,
    startupOpen = true;
  let active = true,
    stopped = false,
    reason = null,
    pending = null;

  function status() {
    return { phase, stopped, reason };
  }
  function settlePending(result) {
    if (!pending) return;
    const acquisition = pending;
    pending = null;
    acquisition.resolve(result);
  }
  function halt(code) {
    if (!stopped) {
      stopped = true;
      runBudget.stop();
      reason = code;
      phase = 'stopped';
      startupOpen = false;
      settlePending(no(reason));
      // Dispatch immediately; a pending quota or interrupt reply is not a lock.
      try {
        Promise.resolve(onInterrupt(code)).catch(() => {});
      } catch {
        /* fixed outward code only */
      }
    }
    return no(reason);
  }
  function available() {
    if (active && !stopped && runBudget.stopped()) halt('USAGE_NOT_ADMISSIBLE');
    return active && !stopped;
  }
  function usage(response, observedAt) {
    try {
      const stamp = now();
      if (!runBudget.check(response, { observedAt, now: stamp }).allowed)
        return halt('USAGE_NOT_ADMISSIBLE');
      return yes();
    } catch {
      return halt('USAGE_NOT_ADMISSIBLE');
    }
  }
  function sample(boundary, observation) {
    if (!available()) return no(reason || 'GENERATION_RETIRED');
    const expectedPhase = {
      'before-thread': 'startup',
      'before-turn': 'thread-admitted',
      'after-turn': 'turn-finished',
    }[boundary];
    if (
      !expectedPhase ||
      phase !== expectedPhase ||
      pending ||
      (boundary === 'before-thread' && startupOpen)
    )
      return halt('SAMPLE_OUT_OF_ORDER');
    try {
      if (
        accountFingerprint(observation?.account, observation?.usage) !==
        expectedFingerprint
      )
        return halt('ACCOUNT_MISMATCH');
    } catch {
      return halt('ACCOUNT_IDENTITY_INVALID');
    }
    if (
      Object.keys(selection).some(
        (k) => observation?.effective?.[k] !== selection[k],
      )
    )
      return halt('SELECTION_MISMATCH');
    if (boundary !== 'after-turn') {
      if (
        !hooksAdmissible(
          observation?.hooks,
          boundary === 'before-thread' ? 'cwd' : 'thread',
        )
      )
        return halt('HOOKS_NOT_ADMISSIBLE');
      try {
        if (
          instructionDigest(observation?.instructions) !== expectedInstructions
        )
          return halt('INSTRUCTIONS_CHANGED');
      } catch {
        return halt('INSTRUCTIONS_CHANGED');
      }
    }
    if (!usage(observation?.usage, observation?.observedAt).allowed)
      return no(reason);
    if (boundary === 'before-thread') {
      startupOpen = false;
      phase = 'thread-admitted';
    }
    if (boundary === 'before-turn') phase = 'turn-admitted';
    if (boundary === 'after-turn') phase = 'complete';
    return yes();
  }
  function preflight(observation) {
    if (!available() || phase !== 'startup') return halt('SAMPLE_OUT_OF_ORDER');
    if (!hooksAdmissible(observation?.hooks, 'cwd'))
      return halt('HOOKS_NOT_ADMISSIBLE');
    try {
      if (instructionDigest(observation?.instructions) !== expectedInstructions)
        return halt('INSTRUCTIONS_CHANGED');
    } catch {
      return halt('INSTRUCTIONS_CHANGED');
    }
    return yes();
  }
  function accountUpdated() {
    if (!active) return no('GENERATION_RETIRED');
    if (stopped) return no(reason);
    if (!startupOpen || ++startupUpdates > 1) return halt('ACCOUNT_UPDATED');
    return yes();
  }
  function initialAccountRead() {
    if (!available()) return no(reason || 'GENERATION_RETIRED');
    if (!startupOpen || phase !== 'startup') return halt('SAMPLE_OUT_OF_ORDER');
    // Called on accepting the FIRST account/read reply, before awaiting usage.
    // Leaving the exemption open until a combined account/usage sample is a race.
    startupOpen = false;
    return yes();
  }
  function beginTurn() {
    if (!available()) return no(reason || 'GENERATION_RETIRED');
    if (phase !== 'turn-admitted' || pending) return halt('TURN_OUT_OF_ORDER');
    phase = 'turn-running';
    return yes();
  }
  function completeTurn(turnStatus) {
    if (!available()) return no(reason || 'GENERATION_RETIRED');
    if (phase !== 'turn-running' || turnStatus !== 'completed' || pending)
      return halt('TURN_NOT_COMPLETED');
    phase = 'turn-finished';
    return yes();
  }
  function refreshUsage(read) {
    if (!available())
      return Promise.resolve(no(reason || 'GENERATION_RETIRED'));
    if (phase !== 'turn-running')
      return Promise.resolve(halt('USAGE_OUT_OF_ORDER'));
    if (pending) return pending.promise;
    if (typeof read !== 'function')
      return Promise.resolve(halt('USAGE_NOT_ADMISSIBLE'));
    const acquisition = {};
    acquisition.promise = new Promise((resolve) => {
      acquisition.resolve = resolve;
    });
    pending = acquisition;
    let result;
    try {
      result = read();
    } catch {
      halt('USAGE_NOT_ADMISSIBLE');
      return acquisition.promise;
    }
    Promise.resolve(result).then(
      (value) => {
        if (!available() || pending !== acquisition) return;
        const checked = usage(value?.response, value?.observedAt);
        // usage() can synchronously halt and settle this acquisition itself.
        if (pending === acquisition) settlePending(checked);
      },
      () => {
        if (available() && pending === acquisition)
          halt('USAGE_NOT_ADMISSIBLE');
      },
    );
    return acquisition.promise;
  }
  function stop(code) {
    const allowed = [
      'operator-refused',
      'operator-cancelled',
      'operator-unavailable',
      'operator-expired',
      'operator-text',
    ];
    return halt(allowed.includes(code) ? code : 'MANAGED_STOPPED');
  }
  function retire() {
    active = false;
    startupOpen = false;
    stopped = true;
    reason ||= 'GENERATION_RETIRED';
    phase = 'retired';
    settlePending(no(reason));
  }
  return Object.freeze({
    runBudget,
    preflight,
    sample,
    initialAccountRead,
    accountUpdated,
    beginTurn,
    completeTurn,
    refreshUsage,
    stop,
    retire,
    status,
  });
}

module.exports = { accountFingerprint, enrollAccount, createManagedAdmission };
