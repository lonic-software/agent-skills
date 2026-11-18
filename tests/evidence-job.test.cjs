'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { createJob } = require('../codex/runtime/evidence.cjs');
const repo = path.resolve(__dirname, '..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-job-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configFile = path.join(root, 'config.json'),
    memo = path.join(root, 'memo.md');
  const config = {
    schema: 1,
    codex: 'EXAMPLE-codex',
    tetel: 'EXAMPLE-tetel',
    model: 'EXAMPLE-model',
    runRoot: path.join(root, 'runs'),
  };
  fs.writeFileSync(configFile, JSON.stringify(config));
  fs.writeFileSync(memo, 'EXAMPLE MEMO\n');
  return { root, configFile, memo, config, mode: 'grounder', repo };
}
test('each pass has fresh state and leaves existing login selection untouched', (t) => {
  const x = fixture(t),
    original = process.env.CODEX_HOME;
  const a = createJob(x),
    b = createJob(x);
  assert.notEqual(a.job.workspace, b.job.workspace);
  assert.notEqual(a.job.workDir, b.job.workDir);
  assert.equal(process.env.CODEX_HOME, original);
  assert.equal(Object.hasOwn(a.job, 'codeHome'), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(a.job.jobPath, 'utf8')), a.job);
  assert.equal(fs.existsSync(a.job.result), false);
});
test('only attacker receives its exact memo-length command', (t) => {
  const x = fixture(t);
  assert.deepEqual(createJob(x).job.allowedCommands, []);
  const result = createJob({ ...x, mode: 'attacker' });
  assert.deepEqual(result.job.allowedCommands, [
    ['wc', '-l', fs.realpathSync(x.memo)],
  ]);
});
test('malformed policy and unknown configuration fail before creating run state', (t) => {
  for (const patch of [
    { codeHome: 'EXAMPLE-other-profile' },
    { allowedCommands: [['node', '']] },
    { timeoutMs: 0 },
    { model: '' },
    { schema: 2 },
  ]) {
    const x = fixture(t);
    fs.writeFileSync(x.configFile, JSON.stringify({ ...x.config, ...patch }));
    assert.throws(() => createJob(x));
    assert.equal(fs.existsSync(x.config.runRoot), false);
  }
});
test('memo and run state inside the source tree are refused', (t) => {
  const x = fixture(t);
  assert.throws(
    () => createJob({ ...x, memo: path.join(repo, 'README.md') }),
    /outside/,
  );
  fs.writeFileSync(
    x.configFile,
    JSON.stringify({
      ...x.config,
      runRoot: path.join(repo, 'EXAMPLE-RUNS-MUST-NOT-EXIST'),
    }),
  );
  assert.throws(() => createJob(x), /outside/);
  assert.equal(
    fs.existsSync(path.join(repo, 'EXAMPLE-RUNS-MUST-NOT-EXIST')),
    false,
  );
});
