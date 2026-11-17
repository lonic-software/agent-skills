'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {createProfileGuard} = require('../codex/runtime/managed-profile.cjs');
const {createIntentJournal, validateEnrollment, projectState} = require('../codex/runtime/managed-storage.cjs');
function temporary(action) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-profile-')); try { return action(root); } finally { fs.rmSync(root, {recursive: true, force: true}); } }
test('profile baseline is run-local content hash/size, auth stays metadata-only', () => temporary(root => {
  const config = path.join(root, 'config.toml'), auth = path.join(root, 'auth.json');
  fs.writeFileSync(config, 'new baseline'); fs.writeFileSync(auth, 'PRIVATE never read');
  const reads = [], io = {...fs, readFileSync(file, ...args) { reads.push(file); assert.notEqual(file, auth); return fs.readFileSync(file, ...args); }};
  const guard = createProfileGuard(root, {io});
  fs.utimesSync(config, new Date(), new Date(Date.now() + 10000)); assert.equal(guard.verify(), true);
  fs.writeFileSync(config, 'bad baseline'); assert.equal(guard.verify(), false); fs.writeFileSync(config, 'new baseline'); assert.equal(guard.verify(), false);
  assert.ok(reads.every(file => file === config));
  const next = createProfileGuard(root, {io}); fs.utimesSync(auth, new Date(), new Date(Date.now() + 20000)); assert.equal(next.verify(), false);
}));
test('fresh run accepts current config bytes; baseline audit cannot mutate the guard', () => temporary(root => {
  fs.writeFileSync(path.join(root, 'config.toml'), 'current bytes'); fs.writeFileSync(path.join(root, 'auth.json'), 'PRIVATE');
  const guard = createProfileGuard(root, {audit: value => { value.config.sha256 = 'forged'; }});
  assert.equal(guard.verify(), true); assert.notEqual(guard.baseline().config.sha256, 'forged');
}));
test('intent journal refuses unresolved prior run and only settles the registered generation', () => temporary(root => {
  const one = createIntentJournal(root, 'one'); one.begin(); one.register({id: 'author', generation: 'g1'}); one.recordProcess({pid: 123});
  assert.throws(() => createIntentJournal(root, 'two').begin(), /RECOVERY_REQUIRED/);
  assert.throws(() => one.settle({id: 'author', generation: 'wrong'}), /INTENT_ORDER/); assert.throws(() => one.finish(), /RECOVERY_REQUIRED/);
  one.settle({id: 'author', generation: 'g1'}); one.finish(); const two = createIntentJournal(root, 'two'); two.begin(); two.finish();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'intent.json'), 'utf8')).intents, []);
}));
test('enrollment storage accepts only the fingerprint schema, no raw account fields', () => {
  const pin = {schema: 1, algorithm: 'm2-account-v1', fingerprint: 'a'.repeat(64)};
  assert.equal(validateEnrollment(pin).fingerprint, pin.fingerprint);
  assert.throws(() => validateEnrollment({...pin, email: 'PRIVATE'}), /ENROLLMENT_INVALID/);
});
test('state creation refuses a linked ancestor before writing through it', () => temporary(root => {
  const project = path.join(root, 'project'), target = path.join(root, 'target'), alias = path.join(root, 'alias');
  fs.mkdirSync(project); fs.mkdirSync(target); fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => projectState(path.join(alias, 'new-state'), project), /STATE_UNCERTAIN/);
  assert.equal(fs.existsSync(path.join(target, 'new-state')), false);
}));
