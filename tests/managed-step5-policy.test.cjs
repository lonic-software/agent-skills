'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {fixture} = require('./fixtures/managed-run-fixture.cjs');
const {verifyResult} = require('../codex/runtime/managed-result.cjs');
const {cleanGitEnvironment} = require('../codex/runtime/managed-git-env.cjs');
for (const [variant, authors, handoff] of [['first-stop', 1, 'stop'], ['third', 2, 'continue'], ['second-stop', 2, 'stop']]) test('clean incomplete result: ' + variant, async () => {
  const f = fixture(variant), result = await f.run();
  assert.equal(result.status, 'incomplete'); assert.equal(result.recoveryRequired, false); assert.equal(result.authors, authors);
  assert.equal(verifyResult(result.bytes, result.receipt), true);
  const actual = JSON.parse(result.bytes.toString()); assert.equal(actual.status, handoff); assert.equal(actual.context.summary, 'EXAMPLE context');
  assert.equal(f.events.filter(e => e === 'gate-release').length, 1);
  assert.equal(f.frames.filter(m => m.method === 'turn/start').length, authors);
});
test('editor Git hints are allowed then scrubbed; repository/config redirection refuses', () => {
  const clean = cleanGitEnvironment({PATH: 'EXAMPLE', GIT_ASKPASS: 'never-run', GIT_TRACE: 'never-written', GIT_EDITOR: 'never-run'});
  assert.deepEqual(clean, {PATH: 'EXAMPLE', GIT_TERMINAL_PROMPT: '0'});
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_OBJECT_DIRECTORY', 'git_common_dir']) assert.throws(() => cleanGitEnvironment({[key]: 'redirect'}), /REDIRECTION_REFUSED/);
});
