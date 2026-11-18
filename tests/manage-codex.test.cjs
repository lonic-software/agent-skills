'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { savePlan, transact } = require('../bin/manage-codex.cjs');
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-update-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo'),
    project = path.join(root, 'project'),
    target = path.join(project, '.agents', 'skills', 'example', 'SKILL.md');
  fs.mkdirSync(path.join(repo, 'codex', 'skills', 'example'), {
    recursive: true,
  });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'EXAMPLE user customization');
  fs.writeFileSync(
    path.join(repo, 'codex', 'skills', 'example', 'SKILL.md'),
    'EXAMPLE new package',
  );
  fs.writeFileSync(
    path.join(repo, 'codex', 'skills', 'example', 'new.txt'),
    'EXAMPLE new file',
  );
  fs.writeFileSync(
    path.join(repo, 'codex', 'manifest.json'),
    JSON.stringify({
      schema: 1,
      selections: { example: { skills: ['example'], agents: [] } },
      blocked: {},
    }),
  );
  return {
    root,
    repo,
    project,
    target,
    file: path.join(root, 'reviewed-plan.json'),
  };
}
test('preview preserves custom content; exact approval updates and rollback restores it', (t) => {
  const s = setup(t),
    p = savePlan(s.repo, s.project, 'example', s.file);
  assert.equal(fs.readFileSync(s.target, 'utf8'), 'EXAMPLE user customization');
  assert.throws(() => transact(s.file, '0'.repeat(64)), /digest/);
  assert.equal(transact(s.file, p.sha256).status, 'applied');
  assert.equal(fs.readFileSync(s.target, 'utf8'), 'EXAMPLE new package');
  assert.equal(
    transact(s.file, p.sha256, { rollback: true }).status,
    'rolled-back',
  );
  assert.equal(fs.readFileSync(s.target, 'utf8'), 'EXAMPLE user customization');
  assert.equal(
    fs.existsSync(path.join(path.dirname(s.target), 'new.txt')),
    false,
  );
});
test('edits after preview or deployment block the whole transaction', (t) => {
  const s = setup(t),
    p = savePlan(s.repo, s.project, 'example', s.file);
  fs.writeFileSync(s.target, 'EXAMPLE later edit');
  assert.throws(() => transact(s.file, p.sha256), /changed/);
  assert.equal(
    fs.existsSync(path.join(path.dirname(s.target), 'new.txt')),
    false,
  );
  fs.writeFileSync(s.target, 'EXAMPLE user customization');
  transact(s.file, p.sha256);
  fs.writeFileSync(s.target, 'EXAMPLE after deployment');
  assert.throws(
    () => transact(s.file, p.sha256, { rollback: true }),
    /changed/,
  );
  assert.equal(fs.readFileSync(s.target, 'utf8'), 'EXAMPLE after deployment');
});
test('links and altered plans are refused', (t) => {
  const s = setup(t),
    p = savePlan(s.repo, s.project, 'example', s.file);
  fs.appendFileSync(s.file, ' ');
  assert.throws(() => transact(s.file, p.sha256), /digest/);
  const link = path.join(s.root, 'link');
  fs.symlinkSync(
    s.project,
    link,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.throws(
    () => savePlan(s.repo, link, 'example', path.join(s.root, 'second.json')),
    /link|junction/,
  );
});
