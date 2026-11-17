'use strict';
// Operator acknowledgement only. This module has no signal/kill operation.
const fs = require('node:fs'), path = require('node:path'), {randomUUID, createHash} = require('node:crypto');
const {projectState, readJSON, writeJSON, validIdentity} = require('./managed-storage.cjs');
const {createWindowsTreeBackend} = require('./managed-windows-tree.cjs');
const {createWindowsGateAdapter, gateIdentity} = require('./managed-windows-gate.cjs');
const {createManagedGate} = require('./managed-gate.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function recoveryIdentities(state) {
  if (state?.schema !== 1 || !['active', 'settled'].includes(state.status) || !Array.isArray(state.intents) || state.intents.some(i => !['active', 'settled'].includes(i.status) || typeof i.id !== 'string')) throw Error('MANAGED_RECOVERY_RECORD_INVALID');
  const active = state.intents.filter(i => i.status !== 'settled');
  if (state.status === 'settled' && !active.length) return [];
  if (!validIdentity(state.owner)) throw Error('MANAGED_RECOVERY_IDENTITY_MISSING');
  const identities = [state.owner];
  for (const i of active) {
    // The write-ahead spawn marker is persisted before any launch attempt.
    // A dead owner plus this explicit negative record proves no author spawn.
    if (i.spawnOutcome === 'not-created' && i.noProcessEvidence?.kind === 'node-error-no-pid-closed' && i.noProcessEvidence.noPid === true && i.noProcessEvidence.spawnEvent === false && i.noProcessEvidence.errorObserved === true && i.noProcessEvidence.streamsClosed === true && i.noProcessEvidence.childClosed === true && !i.pidHint && !i.identities?.length) continue;
    if (i.spawnAttempted === false && !i.pidHint && (!i.identities || i.identities.length === 0)) continue;
    if (!Array.isArray(i.identities) || !i.identities.length || i.identities.some(p => !validIdentity(p))) throw Error('MANAGED_RECOVERY_IDENTITY_MISSING');
    identities.push(...i.identities);
  }
  return identities;
}
async function confirmAbsent(backend, identities) {
  const view = await backend.observe();
  if (view?.complete !== true || !Array.isArray(view.processes) || view.processes.some(p => !Number.isSafeInteger(p?.pid) || p.pid < 0) || new Set(view.processes.map(p => p.pid)).size !== view.processes.length || identities.some(p => view.processes.some(q => q.pid === p.pid && !validIdentity(q)))) throw Error('MANAGED_RECOVERY_OBSERVATION_UNCERTAIN');
  // PID reuse is not the recorded process; never signal either incarnation.
  if (identities.some(p => view.processes.some(q => p.pid === q.pid && p.created === q.created))) throw Error('MANAGED_RECOVERY_PROCESS_LIVE');
}
async function reconcileManaged({project, stateRoot, terminal, afterReboot = false}, dependencies = {}) {
  if (terminal?.inputTTY !== true || terminal?.outputTTY !== true) throw Error('INTERACTIVE_TERMINAL_REQUIRED');
  const state = projectState(path.resolve(stateRoot), fs.realpathSync(project)), runId = randomUUID();
  const backend = dependencies.backend || createWindowsTreeBackend({mode: 'managed', commandTimeoutMs: 15000});
  const adapter = dependencies.adapter || createWindowsGateAdapter({mode: 'managed', gatePath: state.gatePath, timeoutMs: 15000});
  const gate = dependencies.gate || createManagedGate({mode: 'managed', expectedIdentity: gateIdentity(state.gatePath), registeredIntent: {id: runId + ':reconcile'}, adapter, timeoutMs: 20000});
  const file = path.join(state.dir, 'intent.json'); let held = false;
  try {
    const acquired = await gate.acquire(); if (!acquired.allowed) throw Error(acquired.reason || 'MANAGED_RECOVERY_GATE_REQUIRED'); held = true;
    const previous = readJSON(file), original = hash(fs.readFileSync(file));
    const display = JSON.stringify({runId: previous.runId, status: previous.status, owner: previous.owner, unresolved: previous.intents?.filter(i => i.status !== 'settled')}).replace(/[\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    const displayed = typeof terminal.display === 'function';
    if (displayed) terminal.display(display);
    let rebootEvidence;
    let identities;
    if (afterReboot) {
      // Never infer a boot from PID absence, sleep/resume, or wall-clock age.
      if (!validIdentity(previous.owner) || !/^\d{18}$/.test(previous.owner.created) || previous.schema !== 1 || !Array.isArray(previous.intents)) throw Error('MANAGED_RECOVERY_IDENTITY_MISSING');
      const boot = await (dependencies.readBoot || require('./managed-windows-boot.cjs').readWindowsBoot)();
      if (!/^\d{18}$/.test(boot) || BigInt(boot) <= BigInt(previous.owner.created)) throw Error('MANAGED_RECOVERY_REBOOT_REQUIRED');
      rebootEvidence = {boot, ownerCreated:previous.owner.created}; identities = [previous.owner];
    } else identities = recoveryIdentities(previous);
    if (!identities.length) return {status: 'nothing-to-reconcile', count: 0};
    await backend.prepare?.();
    await confirmAbsent(backend, identities);
    const entries = previous.intents.filter(i => i.status !== 'settled');
    // JSON escaping keeps persisted text from acting as terminal control input.
    if (await terminal.confirm((displayed ? '' : display) + (afterReboot ? '\nWindows boot is later than the recorded controller creation. Confirm that a FULL Restart was performed, not sleep/hibernate/sign-out. Type RECONCILE-AFTER-REBOOT to acknowledge abandoned work:' : '\nAll recorded identities are absent. Polling cannot exclude unobserved descendants. Type RECONCILE to acknowledge and close these entries:')) !== (afterReboot ? 'RECONCILE-AFTER-REBOOT' : 'RECONCILE')) throw Error('MANAGED_RECOVERY_NOT_CONFIRMED');
    await confirmAbsent(backend, identities);
    if (afterReboot && await (dependencies.readBoot || require('./managed-windows-boot.cjs').readWindowsBoot)() !== rebootEvidence.boot) throw Error('MANAGED_BOOT_UNCERTAIN');
    if (!(await gate.check()).allowed || hash(fs.readFileSync(file)) !== original) throw Error('MANAGED_RECOVERY_CHANGED');
    readJSON(file); // Recheck regular-file identity immediately before replacement.
    writeJSON(file + '.' + runId + '.previous.json', previous, true);
    const next = {...previous, status: 'settled', intents: previous.intents.map(i => ({...i, status: 'settled'})), reconciliation: {kind: afterReboot ? 'interactive-after-full-reboot' : 'interactive-operator', rebootEvidence, at: new Date().toISOString(), observedIdentities: identities}};
    writeJSON(file, next);
    return {status: 'reconciled', count: entries.length};
  } finally {
    if (held) { const closed = await gate.release(); if (!closed.allowed) { await adapter.abandon?.(); throw Error('MANAGED_RECOVERY_GATE_CLOSE_UNCERTAIN'); } }
    else await adapter.abandon?.();
  }
}
module.exports = {reconcileManaged, recoveryIdentities, confirmAbsent};
