'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { plan, apply } = require('../bin/install-codex.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-installer-test-'));
  // The root is created by this test, never derived from a project/user path.
  t.after(() => {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('lonic-installer-test-'));
    assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const repo = path.join(root, 'source'),
    project = path.join(root, 'project with spaces');
  fs.mkdirSync(path.join(repo, 'codex', 'skills', 'sample'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(repo, 'codex', 'agents'), { recursive: true });
  fs.mkdirSync(project);
  fs.writeFileSync(
    path.join(repo, 'codex', 'skills', 'sample', 'SKILL.md'),
    'EXAMPLE ONLY: installer fixture, not an executable skill.\n',
  );
  fs.writeFileSync(
    path.join(repo, 'codex', 'agents', 'sample-agent.toml'),
    'EXAMPLE ONLY: installer fixture, not an agent.\n',
  );
  fs.writeFileSync(
    path.join(repo, 'codex', 'manifest.json'),
    JSON.stringify({
      schema: 1,
      status: 'fixture',
      selections: { sample: { skills: ['sample'], agents: ['sample-agent'] } },
      blocked: { powerup: 'unverified boundary' },
    }),
  );
  fs.writeFileSync(path.join(project, 'AGENTS.md'), 'USER CONTENT\n');
  return { root, repo, project };
}
test('preview is read-only; apply and repeat preserve unrelated user files', (t) => {
  const f = fixture(t),
    p = plan(f.repo, f.project, 'sample');
  assert.equal(p.files.length, 2);
  assert.ok(p.files.every((file) => file.status === 'CREATE'));
  assert.deepEqual(fs.readdirSync(f.project), ['AGENTS.md']);
  assert.equal(apply(p), 2);
  assert.equal(
    fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8'),
    'USER CONTENT\n',
  );
  const again = plan(f.repo, f.project, 'sample');
  assert.ok(again.files.every((file) => file.status === 'MATCH'));
  assert.equal(apply(again), 0);
});
test('one conflicting file prevents all writes', (t) => {
  const f = fixture(t),
    p = plan(f.repo, f.project, 'sample');
  fs.mkdirSync(path.dirname(p.files[1].target), { recursive: true });
  fs.writeFileSync(p.files[1].target, 'LOCAL EDIT');
  const conflicting = plan(f.repo, f.project, 'sample');
  assert.throws(() => apply(conflicting), /Existing content differs/);
  assert.equal(fs.existsSync(p.files[0].target), false);
  assert.equal(fs.readFileSync(p.files[1].target, 'utf8'), 'LOCAL EDIT');
});
test('an intervening destination change invalidates the preview', (t) => {
  const f = fixture(t),
    p = plan(f.repo, f.project, 'sample');
  fs.mkdirSync(path.dirname(p.files[1].target), { recursive: true });
  fs.writeFileSync(p.files[1].target, 'NEW USER FILE');
  assert.throws(() => apply(p), /appeared since preview/);
  assert.equal(fs.existsSync(p.files[0].target), false);
});
test('blocked selections and traversal in a manifest fail without writes', (t) => {
  const f = fixture(t);
  assert.throws(() => plan(f.repo, f.project, 'powerup'), /NOT READY/);
  const mf = path.join(f.repo, 'codex', 'manifest.json'),
    manifest = JSON.parse(fs.readFileSync(mf));
  manifest.selections.sample.skills = ['../escape'];
  fs.writeFileSync(mf, JSON.stringify(manifest));
  assert.throws(
    () => plan(f.repo, f.project, 'sample'),
    /Invalid package name/,
  );
  assert.deepEqual(fs.readdirSync(f.project), ['AGENTS.md']);
});
test('a destination symlink or junction cannot redirect writes', (t) => {
  const f = fixture(t),
    outside = path.join(f.root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(
    outside,
    path.join(f.project, '.agents'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.throws(() => plan(f.repo, f.project, 'sample'), /symlink or junction/);
  assert.deepEqual(fs.readdirSync(outside), []);
});
test('source changes after preview fail before any install', (t) => {
  const f = fixture(t),
    p = plan(f.repo, f.project, 'sample');
  fs.writeFileSync(p.files[1].source, 'CHANGED SOURCE');
  assert.throws(() => apply(p), /Source changed since preview/);
  assert.deepEqual(fs.readdirSync(f.project), ['AGENTS.md']);
});

test('a partial write is retained and reported while earlier complete files roll back', (t) => {
  const f = fixture(t),
    p = plan(f.repo, f.project, 'sample');
  const originalWrite = fs.writeSync;
  let writes = 0,
    failure;
  try {
    fs.writeSync = function (fd, buffer, ...args) {
      if (
        Buffer.isBuffer(buffer) &&
        p.files.some((f) => f.bytes.equals(buffer))
      )
        writes++;
      if (writes === 2) {
        originalWrite.call(fs, fd, buffer, 0, 7, null);
        const error = new Error('EXAMPLE injected disk-full write');
        error.code = 'ENOSPC';
        throw error;
      }
      return originalWrite.call(fs, fd, buffer, ...args);
    };
    try {
      apply(p);
    } catch (error) {
      failure = error;
    }
  } finally {
    fs.writeSync = originalWrite;
  }
  assert.equal(failure?.code, 'ENOSPC');
  assert.ok(
    failure.message.includes('partial files retained: ' + p.files[1].target),
    failure.message,
  );
  assert.equal(fs.existsSync(p.files[0].target), false);
  assert.deepEqual(
    fs.readFileSync(p.files[1].target),
    p.files[1].bytes.subarray(0, 7),
  );
  assert.equal(
    fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8'),
    'USER CONTENT\n',
  );
});
test('runtime packaging preserves its directory structure without activating hooks', (t) => {
  const f = fixture(t),
    mf = path.join(f.repo, 'codex', 'manifest.json'),
    m = JSON.parse(fs.readFileSync(mf));
  m.selections.sample.runtime = true;
  fs.writeFileSync(mf, JSON.stringify(m));
  const dir = path.join(f.repo, 'codex', 'runtime', 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'example.cjs'),
    'EXAMPLE inert runtime content',
  );
  const p = plan(f.repo, f.project, 'sample');
  assert.equal(p.files.length, 3);
  assert.equal(apply(p), 3);
  assert.equal(
    fs.readFileSync(
      path.join(
        f.project,
        '.codex',
        'lonic',
        'runtime',
        'hooks',
        'example.cjs',
      ),
      'utf8',
    ),
    'EXAMPLE inert runtime content',
  );
  assert.equal(
    fs.existsSync(path.join(f.project, '.codex', 'hooks.json')),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(f.project, '.codex', 'config.toml')),
    false,
  );
});
