'use strict';
const fs = require('node:fs'), path = require('node:path'), {randomUUID, createHash} = require('node:crypto');
function regular(file) {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || fs.realpathSync(file) !== path.resolve(file)) throw Error('MANAGED_STATE_UNCERTAIN');
}
function directory(dir) {
  let ancestor = path.resolve(dir);
  while (!fs.existsSync(ancestor)) { const parent = path.dirname(ancestor); if (parent === ancestor) throw Error('MANAGED_STATE_UNCERTAIN'); ancestor = parent; }
  if (fs.realpathSync(ancestor) !== ancestor || fs.lstatSync(ancestor).isSymbolicLink()) throw Error('MANAGED_STATE_UNCERTAIN');
  fs.mkdirSync(dir, {recursive: true});
  if (fs.realpathSync(dir) !== path.resolve(dir) || fs.lstatSync(dir).isSymbolicLink()) throw Error('MANAGED_STATE_UNCERTAIN');
}
function readJSON(file) { regular(file); return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJSON(file, value, exclusive = false) {
  const bytes = JSON.stringify(value) + '\n';
  if (exclusive) { const fd = fs.openSync(file, 'wx', 0o600); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } return; }
  regular(file);
  const temp = file + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
function projectState(root, project) {
  directory(root);
  const canonical = fs.realpathSync(project), relative = path.relative(canonical, fs.realpathSync(root));
  if (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) throw Error('MANAGED_STATE_MUST_BE_OUTSIDE_PROJECT');
  const dir = path.join(root, createHash('sha256').update(canonical.toLowerCase()).digest('hex'));
  directory(dir);
  const gatePath = path.join(dir, 'gate.lock');
  try { fs.writeFileSync(gatePath, randomUUID(), {flag: 'wx', mode: 0o600}); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  regular(gatePath);
  return {dir, gatePath};
}
// All calls are made while the cooperative project gate is held. Persisted
// records are recovery obligations, never authority to kill or resume a PID.
function createIntentJournal(dir, runId) {
  const file = path.join(dir, 'intent.json'); let state;
  const save = () => writeJSON(file, state);
  return Object.freeze({
    begin(owner) {
      if (fs.existsSync(file)) {
        const previous = readJSON(file);
        if (previous.schema !== 1 || previous.status !== 'settled' || !Array.isArray(previous.intents) || previous.intents.some(i => i.status !== 'settled')) throw Error('MANAGED_RECOVERY_REQUIRED');
        state = {schema: 1, runId, status: 'active', owner, intents: []}; save();
      } else { state = {schema: 1, runId, status: 'active', owner, intents: []}; writeJSON(file, state, true); }
    },
    recordSpawnAttempt() {
      const active = state?.intents.filter(i => i.status === 'active');
      if (active?.length !== 1) throw Error('MANAGED_INTENT_ORDER');
      active[0].spawnAttempted = true; save();
    },
    recordNoProcess(evidence) {
      const active = state?.intents.filter(i => i.status === 'active');
      if (active?.length !== 1 || active[0].pidHint || active[0].identities?.length || evidence?.kind !== 'node-error-no-pid-closed' || evidence.noPid !== true || evidence.spawnEvent !== false || evidence.errorObserved !== true || evidence.streamsClosed !== true || evidence.childClosed !== true) throw Error('MANAGED_NO_PROCESS_UNCERTAIN');
      active[0].spawnOutcome = 'not-created'; active[0].noProcessEvidence = {...evidence}; save();
    },
    recordIdentity(identity) {
      const active = state?.intents.filter(i => i.status === "active");
      if (active?.length !== 1 || !validIdentity(identity)) throw Error("MANAGED_IDENTITY_UNCERTAIN");
      active[0].spawnAttempted = true; active[0].identities ||= [];
      if (!active[0].identities.some(p => p.pid === identity.pid && p.created === identity.created)) { active[0].identities.push({...identity}); save(); }
    },
    register(intent) {
      if (!state || state.status !== 'active' || typeof intent?.id !== 'string' || typeof intent.generation !== 'string' || state.intents.some(i => i.status !== 'settled' || i.id === intent.id)) throw Error('MANAGED_INTENT_ORDER');
      state.intents.push({id: intent.id, generation: intent.generation, status: 'active', spawnAttempted: false}); save();
    },
    recordProcess(child) {
      const active = state?.intents.filter(i => i.status === 'active');
      if (active?.length !== 1 || !Number.isSafeInteger(child.pid)) throw Error('MANAGED_INTENT_ORDER');
      active[0].spawnAttempted = true; active[0].pidHint = child.pid; save(); // Not termination authority.
    },
    settle(intent) {
      const active = state?.intents.find(i => i.id === intent?.id && i.generation === intent.generation && i.status === 'active');
      if (!active) throw Error('MANAGED_INTENT_ORDER'); active.status = 'settled'; save(); return true;
    },
    unresolved: () => state?.intents.filter(i => i.status !== 'settled').map(i => i.id) || [],
    finish() { if (!state || state.intents.some(i => i.status !== 'settled')) throw Error('MANAGED_RECOVERY_REQUIRED'); state.status = 'settled'; save(); }
  });
}
function validIdentity(p) { return p && Number.isSafeInteger(p.pid) && p.pid > 0 && typeof p.created === 'string' && /^\d+$/.test(p.created); }
function validateEnrollment(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'algorithm,fingerprint,schema' || value.schema !== 1 || value.algorithm !== 'm2-account-v1' || !/^[a-f0-9]{64}$/.test(value.fingerprint)) throw Error('MANAGED_ENROLLMENT_INVALID');
  return Object.freeze({...value});
}
module.exports = {projectState, createIntentJournal, readJSON, writeJSON, validateEnrollment, regular, validIdentity};
