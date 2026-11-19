'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { plan, apply } = require('../bin/install-codex.cjs');
const { savePlan, transact } = require('../bin/manage-codex.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-receipt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'),
    project = path.join(root, 'project');
  const skill = path.join(source, 'codex/skills/example');
  fs.mkdirSync(skill, { recursive: true });
  fs.mkdirSync(project);
  for (const name of ['SKILL.md', 'old.txt'])
    fs.writeFileSync(path.join(skill, name), 'original ' + name);
  const selection = { skills: ['example'], agents: [] };
  fs.writeFileSync(
    path.join(source, 'codex/manifest.json'),
    JSON.stringify({
      schema: 1,
      blocked: {},
      selections: { one: selection, two: selection },
    }),
  );
  return { root, source, project, skill };
}
test('after git pull both plans include dropped files and remove uses installed hashes', (t) => {
  const { root, source, project, skill } = fixture(t);
  const git = (dir, ...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgSign=false',
        '-c',
        'core.hooksPath=' + path.join(root, 'empty-hooks'),
        '-C',
        dir,
        ...args,
      ],
      { stdio: 'pipe' },
    );
  git(source, 'init');
  git(source, 'add', '.');
  git(source, 'commit', '-m', 'initial');
  const checkout = path.join(root, 'checkout');
  git(root, 'clone', '--local', source, checkout);
  apply(plan(checkout, project, 'one'));
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'updated');
  fs.unlinkSync(path.join(skill, 'old.txt'));
  git(source, 'add', '-A');
  git(source, 'commit', '-m', 'changed package');
  git(checkout, 'pull', '--ff-only');
  const target = path.join(project, '.agents/skills/example/old.txt');
  const removal = savePlan(
    checkout,
    project,
    'one',
    path.join(root, 'remove'),
    { remove: true },
  );
  assert.equal(removal.files.length, 2);
  assert.ok(removal.files.every((f) => f.after === null));
  const update = savePlan(checkout, project, 'one', path.join(root, 'update'));
  assert.ok(
    update.files.some((f) => f.path.endsWith('old.txt') && f.after === null),
  );
  transact(update.file, update.sha256);
  assert.equal(fs.existsSync(target), false);
  assert.throws(() => transact(removal.file, removal.sha256), /changed/);
  transact(update.file, update.sha256, { rollback: true });
  assert.equal(fs.readFileSync(target, 'utf8'), 'original old.txt');
  transact(removal.file, removal.sha256);
  assert.equal(fs.existsSync(target), false);
});
test('shared files survive removal until the last installed selection is removed', (t) => {
  const { root, source, project } = fixture(t);
  for (const name of ['one', 'two']) apply(plan(source, project, name));
  for (const name of ['one', 'two']) {
    const p = savePlan(source, project, name, path.join(root, name), {
      remove: true,
    });
    transact(p.file, p.sha256);
    assert.equal(
      fs.existsSync(path.join(project, '.agents/skills/example/SKILL.md')),
      name === 'one',
    );
  }
});
test('missing installation receipt gives a recovery instruction for remove and update', (t) => {
  const { root, source, project } = fixture(t);
  for (const remove of [true, false])
    assert.throws(
      () =>
        savePlan(source, project, 'one', path.join(root, 'plan'), { remove }),
      /No installation receipt.*originally installed revision.*--apply/,
    );
});

test('project update and removal preserve the user-owned memory file', (t) => {
  const { root, source, project, skill } = fixture(t);
  const options = {
    scope: 'project',
    codexHome: path.join(root, 'codex-home'),
  };
  const memoryFile = path.join(project, '.codex/lonic/memory.md');
  const installed = path.join(project, '.agents/skills/example/SKILL.md');
  apply(plan(source, project, 'one', options));
  assert.equal(fs.existsSync(memoryFile), false);
  const evidence = Buffer.from(
    'Incident 1: original evidence\r\npromoted into example §2\r\n',
  );
  fs.writeFileSync(memoryFile, evidence);

  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'new package version');
  const update = savePlan(
    source,
    project,
    'one',
    path.join(root, 'update'),
    options,
  );
  transact(update.file, update.sha256);
  assert.equal(fs.readFileSync(installed, 'utf8'), 'new package version');
  assert.deepEqual(fs.readFileSync(memoryFile), evidence);

  const removal = savePlan(source, project, 'one', path.join(root, 'remove'), {
    ...options,
    remove: true,
  });
  transact(removal.file, removal.sha256);
  assert.equal(fs.existsSync(installed), false);
  assert.deepEqual(fs.readFileSync(memoryFile), evidence);
});
