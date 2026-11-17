'use strict';
// best-effort observed tree cleanup, not proof of containment
// No native Codex launch: callers provide the registered launch and OS adapter.
const {performance} = require('node:perf_hooks');
const {policyDiagnostic} = require('./managed-windows-policy.cjs');
const LIMITATION = 'best-effort observed tree cleanup, not proof of containment; polling can miss a short-lived parent and its descendants between observations; an unregistered background process can remain beside the next author; kernel ownership such as a no-breakaway Job Object is required to close this gap';
const error = code => Object.assign(new Error(code), {code});
const identity = p => p && Number.isSafeInteger(p.pid) && p.pid > 0 &&
  Number.isSafeInteger(p.parentPid) && p.parentPid >= 0 && /^\d+$/.test(p.created);
const same = (a,b) => a.pid === b.pid && a.created === b.created && a.parentPid === b.parentPid;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(action, ms) {
  if (ms <= 0) throw error('PROCESS_TIMEOUT');
  let timer;
  try { return await Promise.race([Promise.resolve().then(action), new Promise((_,reject) => { timer = setTimeout(() => reject(error('PROCESS_TIMEOUT')), ms); })]); }
  finally { clearTimeout(timer); }
}
function observeChild(child) {
  let spawned = false; child.once("spawn", () => { spawned = true; });
  let requested = false, revoked = false, exited = false, closed = false;
  let stdout = false, stderr = false, unexpected = false, failed = false, handlers = 0;
  child.on('error', () => { failed = true; });
  child.once('exit', () => { exited = true; unexpected ||= !requested; });
  child.once('close', () => { closed = true; });
  if (!child.stdout || !child.stderr || !child.stdin) throw error('PROCESS_STREAMS_REQUIRED');
  child.stdout.once('close', () => { stdout = true; });
  child.stderr.once('close', () => { stderr = true; });
  child.stdin.on('error', () => { if (!requested) failed = true; });
  return Object.freeze({
    requestClose() { requested = true; revoked = true; child.stdin.end(); },
    live() { return !revoked && !exited && !failed; },
    track(promise) {
      if (revoked) throw error('GENERATION_RETIRED');
      handlers++;
      return Promise.resolve(promise).finally(() => { handlers--; });
    },
    snapshot() { return {exited, closed, stdout, stderr, handlers, unexpected, failed}; },
    noProcess() { return !spawned && child.pid === undefined && failed && closed && stdout && stderr && handlers === 0; }
  });
}
function createManagedProcess({mode, backend, onSpawnAttempt = () => {}, onSpawned = () => {}, onNoProcess = () => {}, onIdentity = () => {}, onStop = () => {}, timeoutMs = 5000, closeTimeoutMs = timeoutMs, monitorMs = 5000, maxMonitorFailures = 2, monitorSlowMs = 1500, pollMs = 25, maxRounds = 8, quietRounds = 2} = {}) {
  if (mode !== 'managed') throw error('MANAGED_MODE_REQUIRED');
  if (!backend || typeof backend.observe !== 'function' || typeof backend.signal !== 'function') throw error('PROCESS_BACKEND_REQUIRED');
  if (![timeoutMs,closeTimeoutMs,monitorMs,pollMs,maxRounds,quietRounds].every(x => Number.isSafeInteger(x) && x > 0) || quietRounds < 2 || quietRounds > maxRounds) throw error('PROCESS_BOUNDS_INVALID');
  if (!Number.isSafeInteger(maxMonitorFailures) || maxMonitorFailures < 0 || maxMonitorFailures > 10 || !Number.isSafeInteger(monitorSlowMs) || monitorSlowMs <= 0) throw error('PROCESS_BOUNDS_INVALID');
  let noProcess = false;
  let child, watcher, root, closing, launched = false, stopped = false, reason = null;
  let intent, members = new Map();
  let monitorTimer, monitorPending, monitoring = false, scanCount = 0;
  const orphans = new Set();
  const absent = new Set(); // Positive absence observations retire PID authority.
  const monitorStats = {attempts:0, successful:0, failures:0, slow:0, consecutiveFailures:0, observationMs:0, transientOrphans:0};
  function halt(code) {
    if (!stopped) { stopped = true; reason = code; try { onStop(code); } catch {} }
    return {allowed: false, reason, recoveryRequired: true, limitation: LIMITATION, ...policyDiagnostic(reason)};
  }
  async function scan(remaining) {
    const view = await bounded(() => backend.observe(), remaining());
    if (view?.complete !== true || !Array.isArray(view.processes)) throw error('PROCESS_OWNERSHIP_UNCERTAIN');
    const rows = new Map();
    for (const p of view.processes) {
      if (!Number.isSafeInteger(p?.pid) || rows.has(p.pid)) throw error('PROCESS_OWNERSHIP_UNCERTAIN');
      rows.set(p.pid, p);
    }
    if (!root) {
      const first = rows.get(child.pid);
      if (!identity(first) || first.parentPid !== process.pid || watcher.snapshot().exited) throw error('PROCESS_OWNERSHIP_UNCERTAIN');
      onIdentity({...first}); root = Object.freeze({...first}); members.set(root.pid, root);
    }
    for (const known of members.values()) {
      const current = rows.get(known.pid);
      if (!current && known.pid !== root.pid) absent.add(known.pid);
      if (known.pid === root.pid && watcher.snapshot().exited && (!current || current.created !== known.created)) absent.add(known.pid);
      if (absent.has(known.pid)) continue;
      if (current && (!identity(current) || !same(known,current))) throw error('PROCESS_PID_REUSED_OR_OWNERSHIP_CHANGED');
    }
    let changed;
    do {
      changed = false;
      for (const p of rows.values()) if ((!members.has(p.pid) || (absent.has(p.pid) && p.pid !== root.pid)) && members.has(p.parentPid)) {
        const parent = rows.get(p.parentPid);
        // A parent PID positively retired and now reused is not our ancestry.
        if (absent.has(p.parentPid) && parent && !same(parent,members.get(p.parentPid))) continue;
        if (!identity(p) || !parent || !same(parent,members.get(p.parentPid)) || BigInt(p.created) < BigInt(parent.created)) throw error('PROCESS_OWNERSHIP_UNCERTAIN');
        onIdentity({...p}); members.set(p.pid, Object.freeze({...p})); absent.delete(p.pid); changed = true;
      }
    } while (changed);
    scanCount++;
    const alive = [...members.values()].filter(p => !absent.has(p.pid) && rows.has(p.pid) && same(rows.get(p.pid),p));
    // Parent exit does not revoke the previously established member identity.
    // Keep the child for checked cleanup; only uncertainty or failed settlement
    // prevents continuation. Count each observed orphan identity once.
    for (const p of alive) if (p.pid !== root.pid && members.has(p.parentPid) && !rows.has(p.parentPid)) {
      const key=p.pid+':'+p.created;
      if (!orphans.has(key)) { orphans.add(key); monitorStats.transientOrphans++; }
    }
    return alive;
  }
  function scheduleMonitor() {
    if (!monitoring || stopped || !watcher?.live()) return;
    monitorTimer = setTimeout(() => {
      const start = performance.now(), deadline = start + timeoutMs;
      monitorStats.attempts++;
      monitorPending = scan(() => deadline - performance.now()).then(() => {
        monitorStats.successful++; monitorStats.consecutiveFailures=0;
      }).catch(e => {
        monitorStats.failures++; monitorStats.consecutiveFailures++;
        // Positive evidence of reused/changed ownership is not a missing sample.
        if (e?.code === 'PROCESS_PID_REUSED_OR_OWNERSHIP_CHANGED' || monitorStats.consecutiveFailures > maxMonitorFailures) halt(e?.code === 'PROCESS_TIMEOUT' ? 'PROCESS_TIMEOUT' : 'PROCESS_OWNERSHIP_UNCERTAIN');
      }).finally(() => {
        const elapsed=performance.now()-start;monitorStats.observationMs+=elapsed;
        if(elapsed>=monitorSlowMs)monitorStats.slow++;
        monitorPending = null; scheduleMonitor();
      });
    }, monitorMs);
    monitorTimer.unref?.();
  }
  return Object.freeze({
    async start({registeredIntent, spawn} = {}) {
      if (launched || stopped) return halt('PROCESS_ALREADY_STARTED');
      if (!registeredIntent || typeof registeredIntent.id !== 'string' || !registeredIntent.id || typeof registeredIntent.generation !== 'string' || !registeredIntent.generation || typeof spawn !== 'function') return halt('PROCESS_INTENT_REQUIRED');
      launched = true;
      intent = Object.freeze({id: registeredIntent.id, generation: registeredIntent.generation});
      const deadline = performance.now() + timeoutMs;
      try {
        // Policy checks happen before the author spawn, not after a .ps1 fails.
        if (backend.prepare) await bounded(() => backend.prepare(), deadline - performance.now());
        // Intent is retained before spawn. No await between spawn and listeners.
        onSpawnAttempt(); child = spawn(intent);
        watcher = observeChild(child);
        if (!Number.isSafeInteger(child.pid)) {
          while (!watcher.noProcess() && deadline > performance.now()) await delay(5);
          if (!watcher.noProcess()) throw error('PROCESS_SPAWN_FAILED');
          const evidence = {kind:'node-error-no-pid-closed', noPid:true, spawnEvent:false, errorObserved:true, streamsClosed:true, childClosed:true};
          onNoProcess(evidence); noProcess = true; reason = 'PROCESS_SPAWN_FAILED';
          return {allowed:false, reason, recoveryRequired:false, noProcess:true};
        }
        onSpawned(child);
        await scan(() => deadline - performance.now());
        if (stopped) return halt(reason);
        monitoring = true;
        scheduleMonitor();
        return {allowed: true};
      } catch (e) { return halt(['PROCESS_SPAWN_FAILED','PROCESS_TIMEOUT','MANAGED_POWERSHELL_POLICY_BLOCKED','MANAGED_POWERSHELL_POLICY_UNAVAILABLE'].includes(e?.code) ? e.code : 'PROCESS_OWNERSHIP_UNCERTAIN'); }
    },
    live() { return !stopped && Boolean(watcher?.live()); },
    trackHandler(promise) { if (stopped || !watcher) throw error('GENERATION_RETIRED'); return watcher.track(promise); },
    status() { return {stopped, reason, noProcess, intent, observation: watcher?.snapshot(), scans: scanCount, registeredMembers: members.size, monitor:{...monitorStats}}; },
    close({turnCompleted = false, admissionRefused = false} = {}) {
      if (closing) return closing;
      // Publish the single-flight promise before stop callbacks can reenter close.
      closing = Promise.resolve().then(async () => {
        monitoring = false;
        clearTimeout(monitorTimer);
        if (noProcess) return {allowed:true, recoveryRequired:false, cleanupObserved:true, termination:'not-created'};
        if (!watcher || !root) { watcher?.requestClose(); return halt('PROCESS_OWNERSHIP_UNCERTAIN'); }
        const deadline = performance.now() + closeTimeoutMs, remaining = () => deadline - performance.now();
        let forced = false, quiet = 0;
        try {
          // Revocation precedes channel close and all awaited cleanup operations.
          watcher.requestClose();
          const initial = watcher.snapshot();
          if (initial.failed || initial.unexpected || (!turnCompleted && !admissionRefused)) halt('PROCESS_UNEXPECTED_EXIT');
          // Join the single in-flight monitor within the SAME close deadline.
          // No concurrent scans can register members after successful settlement.
          if (monitorPending) await bounded(() => monitorPending, remaining());
          for (let round = 0; round < maxRounds; round++) {
            let alive = await scan(remaining);
            const observed = watcher.snapshot();
            if (observed.failed || observed.unexpected || (!turnCompleted && !admissionRefused)) halt('PROCESS_UNEXPECTED_EXIT');
            if (alive.length) {
              quiet = 0;
              // Descendants first. Re-enumerate before EVERY signal, including root.
              for (const candidate of [...alive].reverse()) {
                alive = await scan(remaining);
                if (!alive.some(p => same(p,candidate))) continue;
                const sent = await bounded(() => backend.signal(candidate), remaining());
                if (sent?.verified !== true || !['signalled','gone'].includes(sent.status)) throw error('PROCESS_OWNERSHIP_UNCERTAIN');
                forced ||= sent.status === 'signalled';
              }
            } else {
              quiet++;
              if (quiet >= quietRounds && observed.exited && observed.closed && observed.stdout && observed.stderr && observed.handlers === 0) {
                if (stopped) return {...halt(reason), cleanupObserved: true};
                return {allowed: true, recoveryRequired: false, termination: forced ? (admissionRefused ? 'forced-after-admission-refusal' : 'forced-after-completed-turn') : 'graceful', limitation: LIMITATION};
              }
            }
            await bounded(() => delay(pollMs), remaining());
          }
          // A live child may remain after the parent and all its pipes close.
          const survivors = await scan(remaining);
          if (survivors.length) return halt('PROCESS_SURVIVOR');
          return halt('PROCESS_SETTLEMENT_INCOMPLETE');
        } catch (e) {
          return halt(e?.code === 'PROCESS_TIMEOUT' ? 'PROCESS_TIMEOUT' : 'PROCESS_OWNERSHIP_UNCERTAIN');
        }
      });
      return closing;
    }
  });
}
module.exports = {createManagedProcess, observeChild, bounded, LIMITATION};
