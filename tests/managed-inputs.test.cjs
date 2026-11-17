'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createManagedInputs} = require('../codex/runtime/managed-inputs.cjs');
const {fixture} = require('./fixtures/managed-run-fixture.cjs');
async function repoTest(action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-inputs-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
  const gitEnv = {...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null'};
  const git = args => execFileSync('git', ['-C', root, '-c', 'core.hooksPath=' + path.join(root, 'empty-hooks'), '-c', 'commit.gpgsign=false', ...args], {env: gitEnv, windowsHide: true, stdio: 'pipe'});
  const write = (file, value) => fs.writeFileSync(path.join(root, file), value);
  try {
    git(['init']); git(['config', 'user.name', 'EXAMPLE local fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
    write('tracked.txt', 'original'); write('.gitignore', 'task.txt\ninstructions.txt\n'); write('task.txt', 'ignored task'); write('instructions.txt', 'ignored instruction');
    git(['add', '.']); git(['commit', '-m', 'EXAMPLE fixture baseline']);
    let profile = true;
    const sources = [{key: 'ignored', path: path.join(root, 'instructions.txt')}, {key: 'developer', identity: 'EXAMPLE', content: 'EXAMPLE developer'}];
    const args = {cwd: root, task: {kind: 'file', locator: 'task.txt'}, env, enumerateInstructions: () => ({complete: true, sources}), verifyProfile: () => profile};
    await action({root, write, git, args, sources, setProfile: value => { profile = value; }});
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
}
test('full input capture admits stable state and adopts only a checked post-exit handoff', () => repoTest(async f => {
  const guard = createManagedInputs(f.args); assert.equal(guard.verify('before-turn'), true);
  f.write('tracked.txt', 'author work'); assert.equal(guard.verify('before-turn'), false); assert.equal(guard.acceptHandoff(), false);
  assert.equal(guard.verify('after-exit'), true); assert.equal(guard.acceptHandoff(), true); assert.equal(guard.verify('before-turn'), true);
}));
for (const change of ['worktree', 'index', 'ignored-task', 'ignored-instruction', 'membership', 'profile', 'post-exit-race']) test('input guard refuses ' + change + ' independently', () => repoTest(async f => {
  const guard = createManagedInputs(f.args);
  if (change === 'worktree') f.write('tracked.txt', 'changed!');
  if (change === 'index') { f.write('tracked.txt', 'staged!!'); f.git(['add', 'tracked.txt']); f.write('tracked.txt', 'original'); }
  if (change === 'ignored-task') f.write('task.txt', 'other task!!');
  if (change === 'ignored-instruction') f.write('instructions.txt', 'ignored instructioN');
  if (change === 'membership') f.sources.push({key: 'new-host-source', identity: 'EXAMPLE', content: 'new source'});
  if (change === 'profile') f.setProfile(false);
  if (change === 'post-exit-race') { assert.equal(guard.verify('after-exit'), true); f.write('tracked.txt', 'race'); assert.equal(guard.acceptHandoff(), false); }
  assert.equal(guard.verify('before-turn'), false);
}));
test('Git namespace overrides, external task paths and incomplete instruction inventory refuse', () => repoTest(async f => {
  assert.throws(() => createManagedInputs({...f.args, env: {...f.args.env, GIT_INDEX_FILE: path.join(f.root, 'other-index')}}), /REDIRECTION_REFUSED/);
  assert.throws(() => createManagedInputs({...f.args, task: {kind: 'file', locator: '../outside'}}), /INPUTS_UNCERTAIN/);
  assert.throws(() => createManagedInputs({...f.args, enumerateInstructions: () => ({complete: false, sources: f.sources})}), /INPUTS_UNCERTAIN/);
}));
test('actual index edit during second thread startup prevents the second turn', () => repoTest(async f => {
  const guard = createManagedInputs(f.args), run = fixture();
  run.host.verifyInputs = boundary => guard.verify(boundary);
  run.host.acceptHandoff = () => guard.acceptHandoff();
  const inspect = run.host.inspect; let threadReads = 0;
  run.host.inspect = async (...args) => {
    if (args[0] === 'thread' && ++threadReads === 2) { f.write('tracked.txt', 'staged!!'); f.git(['add', 'tracked.txt']); f.write('tracked.txt', 'original'); }
    return inspect(...args);
  };
  const result = await run.run(); assert.equal(result.status, 'needs-reconciliation');
  assert.equal(run.frames.filter(m => m.method === 'turn/start').length, 1);
}));

test('post-exit adoption refuses a missing tracked leaf behind a substituted junction', () => repoTest(async f => {
  const folder = path.join(f.root, 'folder'), empty = path.join(f.root, 'empty');
  fs.mkdirSync(folder); fs.mkdirSync(empty); fs.writeFileSync(path.join(folder, 'tracked.txt'), 'original');
  f.git(['add', 'folder/tracked.txt']); f.git(['commit', '-m', 'EXAMPLE nested baseline']);
  const guard = createManagedInputs(f.args);
  fs.renameSync(folder, path.join(f.root, 'saved-folder'));
  fs.symlinkSync(empty, folder, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(guard.verify('after-exit'), false); assert.equal(guard.acceptHandoff(), false);
}));

test('benign editor Git environment passes a real input capture', () => repoTest(async f => {
 const guard=createManagedInputs({...f.args,env:{...f.args.env,GIT_ASKPASS:'EXAMPLE-never-executed',GIT_TRACE:'EXAMPLE-never-written'}});assert.equal(guard.verify('before-turn'),true);
}));
