'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {fixture} = require('./fixtures/managed-run-fixture.cjs');

// Only in-memory ChildProcess doubles. Keep each protocol's generated thread
// IDs distinct while exercising OS PID reassignment at the ownership boundary.
for (const repeatedIdentity of [false, true]) test('S22 recycled PID with ' + (repeatedIdentity ? 'repeated identity refuses' : 'new creation time admits'), async () => {
  const f = fixture(), spawn = f.host.spawn;
  f.host.spawn = (...args) => {
    const child = spawn(...args);
    assert.ok(f.children.slice(0, -1).every(c => c.gone), 'earlier processes must have observed closure');
    child.pid = 920001; child.row.pid = child.pid;
    if (repeatedIdentity) child.row.created = '100';
    return child;
  };
  const result = await f.run();
  assert.equal(result.status, repeatedIdentity ? 'needs-reconciliation' : 'completed');
  assert.equal(f.frames.filter(m => m.method === 'turn/start').length, repeatedIdentity ? 1 : 2);
  if (!repeatedIdentity) assert.ok(f.events.indexOf('closed-meter') < f.events.indexOf('spawn-author2'));
});
