'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), {spawn} = require('node:child_process');
const {fixture} = require('./fixtures/managed-run-fixture.cjs');
test('two actual own Node authors and separate meter close in order over fresh pipes', async () => {
  const f = fixture(), own = [], events = []; let role;
  f.options.managedRun.launch = {exe: process.execPath, args: [path.join(__dirname, 'fixtures/managed-slice-stub.cjs')], cwd: __dirname,
    env: {CODEX_HOME: 'EXAMPLE-not-read', SystemRoot: process.env.SystemRoot || 'EXAMPLE', TEMP: process.env.TEMP || 'EXAMPLE', TMP: process.env.TMP || 'EXAMPLE'}};
  f.options.managedRun.processTimeoutMs = 2000;
  const register = f.host.registerIntent;
  f.host.registerIntent = async intent => { await register(intent); role = intent.id.endsWith('meter-2') ? 'meter' : intent.id.endsWith('author-2') ? 'author2' : 'author1'; };
  f.host.spawn = (exe, args, options) => {
    assert.deepEqual(Object.keys(options.env).sort(), ['CODEX_HOME', 'SystemRoot', 'TEMP', 'TMP'].sort());
    const child = spawn(exe, [...args, role], {...options, detached: true});
    const owned = {child, role, row: {pid: child.pid, parentPid: process.pid, created: String(100 + own.length)}, closed: false};
    own.push(owned); events.push('spawn-' + role);
    child.once('close', () => { owned.closed = true; events.push('closed-' + owned.role); });
    return child;
  };
  // Test-owned retained handles only; this is not a native OS inventory claim.
  f.host.backend = {observe: async () => ({complete: true, processes: own.filter(o => !o.closed && o.child.exitCode === null && o.child.signalCode === null).map(o => o.row)}),
    signal: async row => {
      const owned = own.find(o => o.row.pid === row.pid && o.row.created === row.created);
      assert.ok(owned); assert.deepEqual(row, owned.row);
      if (owned.child.exitCode !== null || owned.child.signalCode !== null) return {verified: true, status: 'gone'};
      owned.child.kill(); return {verified: true, status: 'signalled'};
    }};
  const result = await f.run(); assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.authors, 2); assert.equal(result.meterClosed, true); assert.equal(own.length, 3); assert.ok(own.every(o => o.closed));
  assert.equal(new Set(own.map(o => o.child.pid)).size, 3);
  assert.ok(events.indexOf('closed-author1') < events.indexOf('spawn-meter'));
  assert.ok(events.indexOf('closed-meter') < events.indexOf('spawn-author2'));
});
