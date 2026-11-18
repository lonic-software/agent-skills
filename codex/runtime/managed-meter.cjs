'use strict';
const { auditNotification } = require('./managed-notification-audit.cjs');
const { spawn } = require('node:child_process');
const { createManagedProcess, bounded } = require('./managed-process.cjs');
const { createManagedRpc } = require('./managed-rpc.cjs');
const { createManagedAdmission } = require('./managed-admission.cjs');

// Separate owned connection. Never creates a thread or turn and never returns
// raw account/usage data. The controller awaits its full close before author 2.
async function runManagedMeter(grant, host, signal) {
  let owner,
    rpc,
    admission,
    stopped = false,
    complete = false,
    intentRecorded = false;
  let rejectStop;
  const interrupted = new Promise((_, reject) => {
    rejectStop = reject;
  });
  interrupted.catch(() => {});
  const stop = () => {
    if (stopped) return;
    stopped = true;
    rpc?.revoke();
    host.runBudget.stop();
    rejectStop(Error('MANAGED_METER_STOPPED'));
  };
  const wait = (promise) => Promise.race([promise, interrupted]);
  const verify = (boundary) => {
    if (host.verifyInputs(boundary) !== true)
      throw Error('MANAGED_INPUTS_CHANGED');
  };
  const timeoutMs = grant.meterTimeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 300000)
    return { allowed: false };
  const timer = setTimeout(stop, timeoutMs);
  signal?.addEventListener('abort', stop, { once: true });
  const intent = Object.freeze({
    id: grant.runId + ':meter-2',
    generation: grant.runId + ':meter-2',
  });
  let cleanup;
  try {
    if (signal?.aborted) stop();
    admission = createManagedAdmission({
      mode: 'managed',
      ...grant,
      runBudget: host.runBudget,
      now: host.now,
      onInterrupt: stop,
    });
    const inventory = await wait(host.inspect('cwd', null));
    if (
      !admission.preflight(inventory).allowed ||
      !(await wait(host.gate.check())).allowed
    )
      throw Error();
    verify('before-meter');
    await wait(host.registerIntent(intent));
    intentRecorded = true;
    owner = createManagedProcess({
      mode: 'managed',
      backend: host.backend,
      onSpawnAttempt: () => host.recordSpawnAttempt?.(),
      onSpawned: (child) => host.recordProcess?.(child),
      onNoProcess: (e) => host.recordNoProcess?.(e),
      onIdentity: (p) => host.recordIdentity?.(p),
      timeoutMs: grant.processTimeoutMs ?? 5000,
      closeTimeoutMs: grant.closeTimeoutMs ?? 30000,
      onStop: stop,
    });
    const started = await owner.start({
      registeredIntent: intent,
      spawn: () => {
        verify('at-meter-spawn');
        const child = (host.spawn || spawn)(
          grant.launch.exe,
          grant.launch.args,
          {
            cwd: grant.launch.cwd,
            env: { ...grant.launch.env },
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        rpc = createManagedRpc(child, {
          canReply: () => false,
          track: (p) => owner.trackHandler(p),
          onFailure: stop,
          onRequest: () => {
            stop();
            throw Error('MANAGED_METER_REQUEST_REFUSED');
          },
          onEvent: (m) => {
            auditNotification(host.audit, m);
            if (m.method === 'account/updated') admission.accountUpdated();
          },
        });
        return child;
      },
    });
    if (!started.allowed) throw Error();
    // Process hint was persisted before the first observation.
    await wait(
      rpc.call('initialize', {
        clientInfo: { name: 'lonic-managed-meter', version: '1' },
        capabilities: { experimentalApi: true },
      }),
    );
    rpc.notify('initialized');
    const account = await wait(
      rpc.call(
        'account/read',
        { refreshToken: false },
        { onResult: () => admission.initialAccountRead() },
      ),
    );
    const usage = await wait(rpc.call('account/rateLimits/read'));
    if (
      !admission.sample('before-thread', {
        account,
        usage,
        effective: grant.selection,
        instructions: inventory.instructions,
        hooks: inventory.hooks,
        observedAt: (host.now || Date.now)(),
      }).allowed
    )
      throw Error();
    complete = true;
  } catch {
    stop();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    rpc?.dispose();
    admission?.retire();
    if (owner)
      cleanup = await owner.close({ turnCompleted: complete && !stopped });
  }
  try {
    if (stopped || !complete || cleanup?.allowed !== true || !intentRecorded)
      throw Error();
    verify('after-meter-exit');
    if (
      (await bounded(
        () => host.settleIntent(intent),
        grant.closeTimeoutMs ?? 30000,
      )) !== true
    )
      throw Error();
    return { allowed: true, termination: cleanup.termination };
  } catch {
    stop();
    return {
      allowed: false,
      recoveryRequired: true,
      reason: 'MANAGED_METER_FAILED',
    };
  }
}
module.exports = { runManagedMeter };
