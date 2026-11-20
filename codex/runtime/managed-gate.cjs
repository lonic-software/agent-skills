'use strict';
const { bounded } = require('./managed-process.cjs');
const { policyDiagnostic } = require('./managed-windows-policy.cjs');
const equal = (a, b) =>
  Boolean(a && b && a.key === b.key && a.identity === b.identity);
function createManagedGate({
  mode,
  expectedIdentity,
  registeredIntent,
  adapter,
  onStop = () => {},
  timeoutMs = 3000,
} = {}) {
  if (mode !== 'managed') throw Error('MANAGED_MODE_REQUIRED');
  if (
    !expectedIdentity?.key ||
    !expectedIdentity.identity ||
    !registeredIntent?.id ||
    !adapter ||
    !['open', 'observe', 'release', 'onLoss'].every(
      (k) => typeof adapter[k] === 'function',
    ) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0
  )
    throw Error('GATE_INPUT_INVALID');
  const expected = Object.freeze({ ...expectedIdentity }),
    intent = Object.freeze({ ...registeredIntent });
  let phase = 'new',
    stopped = false,
    reason = null,
    helper = null,
    releasing;
  function halt(code) {
    if (!stopped) {
      stopped = true;
      reason = code;
      phase = 'stopped';
      try {
        onStop(code);
      } catch {}
    }
    return {
      allowed: false,
      reason,
      recoveryRequired: true,
      ...policyDiagnostic(reason),
    };
  }
  // Observe loss before awaiting acquisition; late success cannot resurrect a gate.
  adapter.onLoss(() => {
    if (phase !== 'released') halt('GATE_HELPER_LOST');
  });
  function valid(v) {
    return (
      v?.locked === true &&
      v.ownerBound === true &&
      v.ownerAlive === true &&
      v.intentId === intent.id &&
      equal(v.gate, expected) &&
      v.helper?.pid > 0 &&
      typeof v.helper.created === 'string'
    );
  }
  function sameHelper(v) {
    return v?.pid === helper?.pid && v?.created === helper?.created;
  }
  return Object.freeze({
    async acquire() {
      if (phase !== 'new' || stopped) return halt('GATE_ORDER_INVALID');
      phase = 'acquiring';
      try {
        const seen = await bounded(
          () =>
            adapter.open({
              expectedIdentity: expected,
              registeredIntent: intent,
            }),
          timeoutMs,
        );
        if (stopped) return halt(reason);
        if (!valid(seen)) return halt('GATE_IDENTITY_OR_OWNER_UNCERTAIN');
        helper = Object.freeze({ ...seen.helper });
        phase = 'held';
        return { allowed: true };
      } catch (e) {
        return halt(
          [
            'MANAGED_POWERSHELL_POLICY_BLOCKED',
            'MANAGED_POWERSHELL_POLICY_UNAVAILABLE',
          ].includes(e?.code)
            ? e.code
            : 'GATE_ACQUIRE_FAILED',
        );
      }
    },
    async check({ survivors = [], unresolvedIntents = [] } = {}) {
      if (stopped || phase !== 'held') return halt(reason || 'GATE_NOT_HELD');
      if (
        !Array.isArray(unresolvedIntents) ||
        unresolvedIntents.length ||
        !Array.isArray(survivors) ||
        survivors.some((p) => !sameHelper(p))
      )
        return halt('GATE_UNSETTLED_OWNERSHIP');
      try {
        const seen = await bounded(() => adapter.observe(), timeoutMs);
        if (stopped) return halt(reason);
        if (!valid(seen) || !sameHelper(seen.helper))
          return halt('GATE_HELPER_LOST');
        return { allowed: true };
      } catch {
        return halt('GATE_OBSERVATION_FAILED');
      }
    },
    release() {
      if (releasing) return releasing;
      releasing = (async () => {
        if (stopped || phase !== 'held') return halt(reason || 'GATE_NOT_HELD');
        phase = 'releasing';
        try {
          const seen = await bounded(() => adapter.release(), timeoutMs);
          if (stopped) return halt(reason);
          if (
            !seen ||
            seen.exited !== true ||
            seen.stdoutClosed !== true ||
            seen.stderrClosed !== true ||
            seen.handlers !== 0 ||
            seen.survivors?.length !== 0
          )
            return halt('GATE_RELEASE_UNOBSERVED');
          phase = 'released';
          return { allowed: true };
        } catch {
          return halt('GATE_RELEASE_UNOBSERVED');
        }
      })();
      return releasing;
    },
    status() {
      return { phase, stopped, reason };
    },
  });
}
module.exports = { createManagedGate };
