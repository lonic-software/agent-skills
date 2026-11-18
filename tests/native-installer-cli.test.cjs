'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { spawnSync } = require('node:child_process');
test('native installer accepts full-preview and preserves preview/check semantics', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-native-preview-'));
  t.after(() => {
    const actual = fs.realpathSync(root);
    assert.equal(path.dirname(actual), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(actual).startsWith('lonic-native-preview-'));
    assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const repo = path.join(root, 'source with spaces'),
    project = path.join(root, 'project with spaces');
  fs.mkdirSync(path.join(repo, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'codex', 'skills', 'sample'), {
    recursive: true,
  });
  fs.mkdirSync(project);
  for (const name of ['install', 'install.ps1', 'install-codex.cjs'])
    fs.copyFileSync(
      path.join(__dirname, '..', 'bin', name),
      path.join(repo, 'bin', name),
    );
  fs.writeFileSync(
    path.join(repo, 'codex', 'manifest.json'),
    JSON.stringify({
      schema: 1,
      status: 'EXAMPLE fixture',
      blocked: {},
      selections: { 'full-preview': { skills: ['sample'], agents: [] } },
    }),
  );
  fs.writeFileSync(
    path.join(repo, 'codex', 'skills', 'sample', 'SKILL.md'),
    'EXAMPLE fixture only.\n',
  );
  fs.writeFileSync(path.join(project, 'AGENTS.md'), 'USER CONTENT\n');
  const win = process.platform === 'win32',
    exe = win ? 'powershell.exe' : 'bash';
  const args = win
    ? [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(repo, 'bin', 'install.ps1'),
        'codex',
        'full-preview',
        '-Scope',
        'project',
        '-Project',
        project,
      ]
    : [
        path.join(repo, 'bin', 'install'),
        'codex',
        'full-preview',
        '--scope',
        'project',
        '--project',
        project,
      ];
  for (const check of [false, true]) {
    const run = spawnSync(
      exe,
      [...args, ...(check ? [win ? '-Check' : '--check'] : [])],
      { encoding: 'utf8', timeout: 15000, windowsHide: true },
    );
    assert.equal(run.error, undefined);
    assert.equal(run.status, check ? 2 : 0, run.stderr || run.stdout);
    const preview = JSON.parse(run.stdout);
    assert.equal(preview.mode, check ? 'check' : 'preview');
    assert.equal(preview.selection, 'full-preview');
    assert.equal(preview.files.length, 1);
    assert.equal(preview.files[0].status, 'CREATE');
    assert.deepEqual(fs.readdirSync(project), ['AGENTS.md']);
    assert.equal(
      fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8'),
      'USER CONTENT\n',
    );
  }
});
