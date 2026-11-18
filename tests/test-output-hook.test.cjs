'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  { spawnSync } = require('node:child_process');
const { rewrite } = require('../codex/runtime/hooks/filter-test-output.cjs');
const wrapper = path.resolve(
  __dirname,
  '../codex/runtime/hooks/test-output.cjs',
);
const event = (command) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: {
    command,
    sandbox_permissions: 'require_escalated',
    justification: 'EXAMPLE permission request',
  },
});
test('only simple recognized test commands are wrapped; permission fields stay intact', () => {
  for (const cmd of [
    'npm test',
    'npm run test:unit',
    'npx vitest run',
    'pytest -q',
    'go test ./...',
    'node --test tests/example.cjs',
  ]) {
    const out = rewrite(event(cmd)).hookSpecificOutput;
    assert.equal(out.permissionDecision, 'allow');
    assert.equal(out.updatedInput.sandbox_permissions, 'require_escalated');
    assert.ok(out.updatedInput.command.endsWith('-- ' + cmd));
  }
});
test('shell syntax, quoted args, alternate commands and escape hatch remain unchanged', () => {
  for (const cmd of [
    'npm test | cat',
    'npm test; echo x',
    'npm test && echo x',
    'npm test > output.txt',
    'npm test\necho x',
    'npm test "path with spaces"',
    'FULL_TEST_OUTPUT=1 npm test',
    'npm test # FULL_TEST_OUTPUT=1',
    'npm install',
    'echo npm test',
    'npm test $TOKEN',
    'npm test %TOKEN%',
    'npm test !TOKEN!',
  ])
    assert.deepEqual(rewrite(event(cmd)), {});
  assert.deepEqual(
    rewrite({ ...event('npm test'), hook_event_name: 'PermissionRequest' }),
    {},
  );
});
test('real subprocess exit code and complete log survive long filtered output', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-filter-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, 'example.cjs');
  fs.writeFileSync(
    script,
    'for(let i=0;i<140;i++)console.log("EXAMPLE row "+i);console.error("FAIL EXAMPLE expected result");console.log("Tests 1 failed");process.exitCode=7;',
  );
  const child = spawnSync(
    process.execPath,
    [wrapper, '--', 'node', script.replace(/\\/g, '/')],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 7, child.stderr);
  assert.match(child.stdout, /FAIL EXAMPLE expected result/);
  assert.doesNotMatch(child.stdout, /EXAMPLE row 0\n/);
  const log = child.stdout.match(/complete log: (.+)\]/)[1];
  assert.match(fs.readFileSync(log, 'utf8'), /EXAMPLE row 0\n/);
  assert.match(fs.readFileSync(log, 'utf8'), /EXAMPLE row 139\n/);
  t.after(() => fs.rmSync(path.dirname(log), { recursive: true, force: true }));
});
test('rewritten command executes through the real platform shell and keeps a successful status', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-hook-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'example.test.cjs');
  fs.writeFileSync(file, 'require("node:test")("EXAMPLE pass",()=>{});');
  const command = 'node --test ' + file.replace(/\\/g, '/');
  const out = rewrite(event(command)).hookSpecificOutput.updatedInput.command;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(out, {
    shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
    encoding: 'utf8',
    env,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /EXAMPLE pass/);
  const log = child.stdout.match(/complete log: (.+)\]/)[1];
  assert.match(fs.readFileSync(log, 'utf8'), /EXAMPLE pass/);
  t.after(() => fs.rmSync(path.dirname(log), { recursive: true, force: true }));
});

test('a missing child command fails explicitly instead of reporting success', (t) => {
  const child = spawnSync(
    process.execPath,
    [wrapper, '--', 'EXAMPLE-NONEXISTENT-LONIC-COMMAND'],
    { encoding: 'utf8' },
  );
  assert.notEqual(child.status, 0);
  assert.match(
    child.stderr + child.stdout,
    /EXAMPLE-NONEXISTENT|ENOENT|not recognized|not found/,
  );
  const log = child.stdout.match(/complete log: (.+)\]/)?.[1];
  if (log)
    t.after(() =>
      fs.rmSync(path.dirname(log), { recursive: true, force: true }),
    );
});
