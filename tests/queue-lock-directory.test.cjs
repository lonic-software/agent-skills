'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { queueLockDirectory } = require('../codex/runtime/queue-lock-directory.cjs');

const windows = process.platform === 'win32';
const posix = { skip: windows && 'POSIX ownership and mode bits only' };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-lock-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('fresh queue namespace and lock directory are private and reusable', (t) => {
  const root = fixture(t);
  const dir = queueLockDirectory(root);
  const parent = path.dirname(dir);
  assert.equal(path.dirname(parent), root);
  assert.equal(path.basename(dir), 'queue-locks');
  if (windows) assert.match(path.basename(parent), /^lonic-codex-[0-9a-f]{64}$/);
  else assert.equal(path.basename(parent), 'lonic-codex-' + process.getuid());
  if (!windows) {
    for (const d of [path.dirname(dir), dir]) {
      assert.equal(fs.lstatSync(d).mode & 0o777, 0o700);
      assert.equal(fs.lstatSync(d).uid, process.getuid());
    }
  }
  assert.equal(queueLockDirectory(root), dir);
});

test('refuses a writable queue namespace or leaf without changing its mode', posix, (t) => {
  for (const [which, mode] of [['parent', 0o720], ['leaf', 0o702]]) {
    const root = fixture(t);
    const dir = queueLockDirectory(root);
    const bad = which === 'parent' ? path.dirname(dir) : dir;
    fs.chmodSync(bad, mode);
    assert.throws(() => queueLockDirectory(root), e =>
      e.message.includes(bad) && e.message.includes('writable by group or others'));
    assert.equal(fs.lstatSync(bad).mode & 0o777, mode);
  }
});

test('refuses a queue namespace owned by a different uid before creating the leaf', posix, (t) => {
  const root = fixture(t);
  const uid = process.getuid();
  const parent = path.join(root, 'lonic-codex-' + uid);
  fs.mkdirSync(parent, { mode: 0o700 });
  // An unprivileged test cannot chown. Only substitute the observed owner.
  const lstat = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', function (file, ...args) {
    const stat = lstat.call(fs, file, ...args);
    if (file === parent) stat.uid = uid + 1;
    return stat;
  });
  assert.throws(() => queueLockDirectory(root), e =>
    e.message.includes(parent) && e.message.includes('owned by uid ' + (uid + 1)));
  assert.deepEqual(fs.readdirSync(parent), []);
});

test('refuses a link at either queue directory without touching its target', (t) => {
  for (const which of ['parent', 'leaf']) {
    const root = fixture(t);
    const dir = queueLockDirectory(root);
    const parent = path.dirname(dir);
    fs.rmdirSync(dir);
    if (which === 'parent') fs.rmdirSync(parent);
    const target = path.join(root, 'target');
    fs.mkdirSync(target);
    const bad = which === 'leaf' ? path.join(parent, 'queue-locks') : parent;
    fs.symlinkSync(target, bad, windows ? 'junction' : 'dir');
    assert.throws(() => queueLockDirectory(root), e =>
      e.message.includes(bad) && e.message.includes('symbolic link'));
    assert.deepEqual(fs.readdirSync(target), []);
  }
});

test('refuses a regular file in place of the queue lock directory', (t) => {
  const root = fixture(t);
  const dir = queueLockDirectory(root);
  fs.rmdirSync(dir);
  fs.writeFileSync(dir, 'fixture');
  assert.throws(() => queueLockDirectory(root), e =>
    e.message.includes(dir) && e.message.includes('not a directory'));
  assert.equal(fs.readFileSync(dir, 'utf8'), 'fixture');
});
