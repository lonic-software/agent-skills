'use strict';
const { runManagedAuthor } = require('./managed-session.cjs');
const { runManagedMeter } = require('./managed-meter.cjs');
const {
  createManagedRunBudget,
  assertManagedRunBudget,
} = require('./managed-run-budget.cjs');
const { createContinuation } = require('./managed-continuation.cjs');
const { captureResult, verifyResult } = require('./managed-result.cjs');
const { authorTimeout } = require('./managed-deadline.cjs');
const { bounded } = require('./managed-process.cjs');
const clone = (value) => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// Process-local spent authorities also protect repeated public entry calls.
// Restart/recovery remains the host intent/gate obligation; no disk import.
const claimedRunIds = new Set(),
  claimedBudgets = new WeakSet();
function createManagedRun(options, host) {
  let used = false;
  return Object.freeze({
    async run() {
      if (used)
        return { status: 'needs-reconciliation', reason: 'MANAGED_RUN_SPENT' };
      used = true;
      let failureOutcome;
      let grant,
        runBudget,
        continuation,
        gateHeld = false,
        authors = 0,
        meterClosed = false;
      const threads = new Set(),
        processes = new WeakSet(),
        processIdentities = new Set();
      let pendingProcess;
      const stop = () => runBudget?.stop();
      const signal = options.signal;
      const check = () => {
        if (signal?.aborted || runBudget.stopped())
          throw Error('MANAGED_RUN_STOPPED');
      };
      try {
        if (
          options.managed !== true ||
          options.managedRun?.continuation !== true ||
          !host ||
          typeof host.acceptHandoff !== 'function'
        )
          throw Error();
        grant = freeze(clone(options.managedRun));
        authorTimeout(grant.timeoutMs);
        if (
          typeof grant.runId !== 'string' ||
          !grant.runId ||
          claimedRunIds.has(grant.runId)
        )
          throw Error('MANAGED_RUN_SPENT');
        runBudget =
          host.runBudget === undefined
            ? createManagedRunBudget({
                mode: 'managed',
                grant: grant.budget,
                bucket: grant.bucket,
              })
            : assertManagedRunBudget(
                host.runBudget,
                grant.budget,
                grant.bucket,
              );
        if (claimedBudgets.has(runBudget)) throw Error('MANAGED_RUN_SPENT');
        claimedRunIds.add(grant.runId);
        claimedBudgets.add(runBudget);
        signal?.addEventListener('abort', stop, { once: true });
        check();
        if (!(await host.gate.acquire()).allowed) throw Error();
        gateHeld = true;
        check();
        // Children borrow this same gate. Their release verifies it; only the run
        // releases the real helper after the final child and all intents settle.
        const gate = Object.freeze({
          acquire: () => host.gate.check(),
          check: () => host.gate.check(),
          release: () => host.gate.check(),
        });
        const childHost = {
          ...host,
          gate,
          runBudget,
          recordProcess(child) {
            if (
              !Number.isSafeInteger(child.pid) ||
              processes.has(child) ||
              pendingProcess
            )
              throw Error('MANAGED_PROCESS_REUSED');
            processes.add(child);
            pendingProcess = child;
            host.recordProcess?.(child);
          },
          recordIdentity(identity) {
            // A PID can be reassigned after observed closure. Admission still
            // requires a fresh, fully observed root identity before any RPC work.
            if (pendingProcess) {
              const key = identity.pid + ':' + identity.created;
              if (
                identity.pid !== pendingProcess.pid ||
                identity.parentPid !== process.pid ||
                !/^\d+$/.test(identity.created) ||
                processIdentities.has(key)
              )
                throw Error('MANAGED_PROCESS_REUSED');
              processIdentities.add(key);
              pendingProcess = null;
            }
            host.recordIdentity?.(identity);
          },
          recordThread(id) {
            if (threads.has(id)) throw Error('MANAGED_THREAD_REUSED');
            threads.add(id);
          },
        };
        const author = async (ordinal, previousContext) => {
          check();
          authors++;
          const result = await runManagedAuthor(
            {
              ...options,
              managedRun: { ...grant, authorOrdinal: ordinal, previousContext },
            },
            childHost,
          );
          if (
            ordinal === 1 &&
            result.status === 'refused' &&
            result.recoveryRequired === false
          )
            return result;
          check();
          if (
            result.status !== 'author-complete' ||
            result.recoveryRequired !== false
          ) {
            failureOutcome = result;
            throw Error();
          }
          // Only an accepted context and observed close can adopt worktree state.
          // This hook must capture/validate a full baseline, never a disk handoff.
          if (host.acceptHandoff(result.handoff, ordinal) !== true)
            throw Error();
          return result;
        };
        let result = await author(1);
        if (result.status === 'refused') {
          const released = await host.gate.release();
          if (!released.allowed) throw Error();
          gateHeld = false;
          return {
            ...result,
            authors,
            continuationSpent: false,
            meterClosed: false,
          };
        }
        continuation = createContinuation(async () => {
          check();
          const meter = await runManagedMeter(grant, childHost, signal);
          if (meter.allowed !== true) throw Error();
          meterClosed = true;
          check();
          // All final admission checks run again inside the fresh author session.
          return author(2, result.handoff.context);
        });
        if (result.handoff.status === 'continue')
          result = await continuation.consume();
        const terminalStatus =
          result.handoff.status === 'done' ? 'completed' : 'incomplete';
        check();
        if (!(await host.gate.check()).allowed) throw Error();
        const released = await bounded(
          () => host.gate.release(),
          grant.closeTimeoutMs ?? 30000,
        );
        if (!released.allowed) throw Error();
        gateHeld = false;
        check();
        // Byte authority is captured from the in-memory accepted result. No file
        // path or later pathname reopen participates in receipt creation.
        const delivery = captureResult(
          Buffer.from(JSON.stringify(result.handoff), 'utf8'),
        );
        const consumed = host.consumeResult
          ? await bounded(
              () => host.consumeResult(delivery),
              grant.closeTimeoutMs ?? 30000,
            )
          : delivery.consume();
        if (consumed !== delivery.consumed())
          throw Error('MANAGED_RESULT_NOT_CONSUMED');
        verifyResult(consumed.bytes, delivery.receipt);
        check();
        return {
          status: terminalStatus,
          authors,
          continuationSpent: continuation.spent(),
          meterClosed,
          bytes: consumed.bytes,
          receipt: delivery.receipt,
          recoveryRequired: false,
        };
      } catch {
        stop();
        return {
          status: 'needs-reconciliation',
          reason: failureOutcome?.reason || 'MANAGED_RUN_FAILED',
          ruleId: failureOutcome?.ruleId,
          cleanupReason: failureOutcome?.cleanupReason,
          continuationSpent: continuation?.spent() ?? false,
          authors,
          meterClosed,
          gateHeld,
          recoveryRequired: true,
        };
      } finally {
        signal?.removeEventListener('abort', stop);
      }
    },
  });
}
async function runManagedQueue(options, host) {
  if (options.managedRun?.continuation === true)
    return createManagedRun(options, host).run();
  return runManagedAuthor(options, host);
}
module.exports = { createManagedRun, runManagedQueue };
