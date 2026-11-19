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
let testRoot;
const savedHome = process.env.CODEX_HOME;
const inherited = process.env.FULL_TEST_OUTPUT;
test.before(() => {
  delete process.env.FULL_TEST_OUTPUT;
  testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-hook-tests-')));
  process.env.CODEX_HOME = path.join(testRoot, 'codex-home');
  fs.mkdirSync(process.env.CODEX_HOME);
  // Do not consult machine policy or a developer's real ancestor .codex directory.
  const lstat = fs.lstatSync;
  test.mock.method(fs, 'lstatSync', function (file, ...args) {
    if (typeof file === 'string' && !file.startsWith(testRoot + path.sep) &&
        (path.basename(file).toLowerCase() === '.codex' ||
         path.basename(path.dirname(file)).toLowerCase() === '.codex' ||
         ['rules', 'requirements.toml'].includes(path.basename(file)) ||
         file === '/etc/codex'))
      throw Object.assign(Error('absent in fixture'), { code: 'ENOENT' });
    return lstat.call(fs, file, ...args);
  });
});
test.after(() => {
  test.mock.restoreAll();
  if (savedHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = savedHome;
  if (inherited !== undefined) process.env.FULL_TEST_OUTPUT = inherited;
  fs.rmSync(testRoot, { recursive: true, force: true });
});
const event = (command) => ({
  cwd: testRoot,
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: {
    command,
    sandbox_permissions: 'use_default',
    justification: 'EXAMPLE permission request',
  },
});
test('only simple recognized test commands are wrapped; permission fields stay intact', () => {
  for (const cmd of [
    'npm test',
    'npm run test:unit',
    'pytest -q',
    'go test ./...',
    'node --test tests/example.cjs',
  ]) {
    const out = rewrite(event(cmd)).hookSpecificOutput;
    assert.equal(out.permissionDecision, 'allow');
    assert.equal(out.updatedInput.sandbox_permissions, 'use_default');
    assert.ok(out.updatedInput.command.endsWith('-- ' + cmd));
  }
});
test('non-default sandbox permissions and unrecognized switches defer to the host', () => {
  for (const permissions of ['require_escalated', 'unknown', null, '']) {
    const input = event('npm test');
    input.tool_input.sandbox_permissions = permissions;
    assert.deepEqual(rewrite(input), {});
  }
  const input = event('npm test');
  delete input.tool_input.sandbox_permissions;
  assert.ok(rewrite(input).hookSpecificOutput);
  for (const cmd of [
    'node --test --import=fixture',
    'node --test -r fixture',
    'node --test --require fixture',
    'go test -exec=fixture ./...',
    'pytest -p fixture',
    'npm run test:unit --prefix=fixture',
    'jest --config fixture',
    'vitest --setupFiles fixture',
    'python -m pytest -pfixture',
  ]) {
    assert.deepEqual(rewrite(event(cmd)), {}, cmd);
  }
});
test('absolute, drive-qualified and parent-segment arguments defer to the host on every platform', () => {
  for (const cmd of [
    'node --test /abs/x.mjs',
    'pytest ../outside',
    'pytest ./tests/../sibling.py',
    'pytest ..',
    'pytest tests/..',
    'node --test C:/abs/example.cjs',
    'node --test C:\\abs\\example.cjs',
    'pytest D:outside.py',
    'pytest \\\\server\\share\\test.py',
    'pytest //server/share/test.py',
    'pytest tests\\..\\outside.py',
    'pytest -- tests/..\\outside.py',
    'pytest tests/valid.py ../outside',
  ])
    assert.deepEqual(rewrite(event(cmd)), {}, cmd);
  for (const cmd of [
    'pytest ./tests/test..name.py',
    'go test ./...',
    'node --test tests/unit/example.test.cjs',
  ]) {
    assert.equal(
      rewrite(event(cmd)).hookSpecificOutput?.permissionDecision,
      'allow',
      cmd,
    );
  }
});
test('npx and bunx require an executable in the command working directory', (t) => {
  const cwd = fs.mkdtempSync(path.join(testRoot, 'lonic-local-runner-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const bin = path.join(cwd, 'node_modules', '.bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const [runner, binary] of [
    ['npx', 'vitest'],
    ['bunx', 'jest'],
  ]) {
    const input = event(runner + ' ' + binary);
    input.tool_input.workdir = cwd;
    assert.deepEqual(rewrite(input), {});
    const shim = path.join(
      bin,
      binary + (process.platform === 'win32' ? '.cmd' : ''),
    );
    fs.writeFileSync(
      shim,
      process.platform === 'win32'
        ? '@echo local-fixture\r\n'
        : '#!/bin/sh\necho local-fixture\n',
      { mode: 0o755 },
    );
    assert.ok(rewrite(input).hookSpecificOutput);
    const run = spawnSync(process.execPath, [wrapper, runner, binary], {
      cwd,
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /local-fixture/);
    const log = run.stdout.match(/complete log: (.+)\]/)[1];
    t.after(() =>
      fs.rmSync(path.dirname(log), { recursive: true, force: true }),
    );
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
  const root = fs.mkdtempSync(path.join(testRoot, 'lonic-filter-fixture-'));
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
  const root = fs.mkdtempSync(path.join(testRoot, 'lonic-hook-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'example.test.cjs');
  fs.writeFileSync(file, 'require("node:test")("EXAMPLE pass",()=>{});');
  const input = event('node --test example.test.cjs');
  input.tool_input.workdir = root;
  const out = rewrite(input).hookSpecificOutput.updatedInput.command;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(out, {
    cwd: root,
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

test('a user rules file leaves the original command and approval to Codex', () => {
  const rule = path.join(process.env.CODEX_HOME, 'rules', 'team.rules');
  fs.mkdirSync(path.dirname(rule));
  try {
    fs.writeFileSync(rule, '');
    assert.deepEqual(rewrite(event('npm test')), {});
  } finally {
    fs.rmSync(path.dirname(rule), { recursive: true });
  }
});

test('a parent rule applies to a nested workdir and to its session cwd', (t) => {
  const project = fs.mkdtempSync(path.join(testRoot, 'team-'));
  const nested = path.join(project, 'repo', 'src');
  const rules = path.join(project, '.codex', 'rules');
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(rules, { recursive: true });
  fs.writeFileSync(path.join(rules, 'local.rules'), 'contents need not be valid');
  const input = event('npm test');
  input.tool_input.workdir = path.relative(input.cwd, nested);
  assert.deepEqual(rewrite(input), {});
  input.cwd = nested;
  input.tool_input.workdir = testRoot;
  assert.deepEqual(rewrite(input), {});
});

test('empty rule directories and unrelated files preserve the existing rewrite', () => {
  const dir = path.join(process.env.CODEX_HOME, 'rules');
  fs.mkdirSync(dir);
  try {
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'no rules');
    const result = rewrite(event('npm test')).hookSpecificOutput;
    assert.equal(result.permissionDecision, 'allow');
    assert.ok(result.updatedInput.command.endsWith('-- npm test'));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('unreadable rules directory defers without returning an approval', t => {
  const dir = path.join(process.env.CODEX_HOME, 'rules');
  fs.mkdirSync(dir);
  t.after(() => fs.rmdirSync(dir));
  const read = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', function (name, ...args) {
    if (name === dir) throw Object.assign(Error('access denied'), { code: 'EACCES' });
    return read.call(fs, name, ...args);
  });
  assert.deepEqual(rewrite(event('npm test')), {});
});

test('a symlink loop on the rules path defers to Codex', {
  skip: process.platform === 'win32' && 'POSIX symlink fixture',
}, t => {
  const dir = path.join(process.env.CODEX_HOME, 'rules');
  fs.symlinkSync('rules', dir);
  t.after(() => fs.unlinkSync(dir));
  assert.deepEqual(rewrite(event('npm test')), {});
});

test('unset CODEX_HOME checks the default rules directory under the user home', t => {
  const home = fs.mkdtempSync(path.join(testRoot, 'fallback-'));
  const dir = path.join(home, '.codex', 'rules');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'default.rules'), '');
  t.mock.method(os, 'homedir', () => home);
  const explicit = process.env.CODEX_HOME;
  delete process.env.CODEX_HOME;
  try {
    assert.deepEqual(rewrite(event('npm test')), {});
  } finally {
    process.env.CODEX_HOME = explicit;
  }
});

test('a filesystem error before listing user rules also defers to Codex', t => {
  const dir = path.join(process.env.CODEX_HOME, 'rules');
  const stat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', function (file, ...args) {
    if (file === dir) throw Object.assign(Error('access denied'), { code: 'EACCES' });
    return stat.call(fs, file, ...args);
  });
  assert.deepEqual(rewrite(event('npm test')), {});
});
