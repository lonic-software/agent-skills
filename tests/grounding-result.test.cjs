'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  parseBrief,
  assessGrounding,
} = require('../codex/runtime/grounding-result.cjs');
const before = {
  floor: 1,
  claims: [
    { id: 'C1', proposition: 'EXAMPLE DATA: source first line is alpha.' },
  ],
  owed: ['C1'],
};
const entry = {
  predicateType: 'https://github.com/lonic-software/tetel/captured-fact/v1',
  subject: [{ name: 'C1' }],
  predicate: {
    pass: 'example-independent-pass',
    verdict: 'supports',
    extent: ['example.txt lines 1-1'],
  },
};
const receipt = {
  claim: 'C1',
  pass: 'example-independent-pass',
  verdict: 'supports',
  from_fact: 'F1',
  recorded: true,
  witnessed: true,
};
const row = (object) => Buffer.from(JSON.stringify(object) + '\n');
function input() {
  return {
    before,
    after: { ...before, owed: [] },
    turnStatus: 'completed',
    initialDigest: 'EXAMPLE_SAME_ARTIFACT',
    finalDigest: 'EXAMPLE_SAME_ARTIFACT',
    initialLedger: Buffer.alloc(0),
    finalLedger: row(entry),
    recordReceipts: [receipt],
  };
}
test('grading completion requires a matching captured record, not turn completion', () => {
  assert.equal(assessGrounding(input()).groundingComplete, true);
  const pending = input();
  pending.after = before;
  pending.finalLedger = Buffer.alloc(0);
  pending.recordReceipts = [];
  assert.equal(assessGrounding(pending).groundingComplete, false);
});
test('a clean empty worklist completes without approving the design', () => {
  const x = input();
  x.before = { ...before, owed: [] };
  x.initialLedger = x.finalLedger;
  x.recordReceipts = [];
  const r = assessGrounding(x);
  assert.equal(r.status, 'nothing-owed');
  assert.equal(r.designApproved, false);
});
test('refutes and qualifies are completed grading, never design approval', () => {
  for (const verdict of ['refutes', 'qualifies']) {
    const x = input();
    x.recordReceipts = [{ ...receipt, verdict }];
    x.finalLedger = row({
      ...entry,
      predicate: { ...entry.predicate, verdict },
    });
    const r = assessGrounding(x);
    assert.equal(r.groundingComplete, true);
    assert.equal(r.designApproved, false);
  }
});
test('changed wording, artifacts, or confirmation floor invalidate the pass', () => {
  for (const change of [
    (x) => (x.finalDigest = 'EXAMPLE_CHANGED'),
    (x) => (x.after = { ...x.after, floor: 2 }),
    (x) =>
      (x.after = {
        ...x.after,
        claims: [{ ...before.claims[0], proposition: 'EXAMPLE CHANGED' }],
      }),
  ]) {
    const x = input();
    change(x);
    assert.equal(assessGrounding(x).status, 'invalidated');
  }
});
test('foreign or unwitnessed records cannot satisfy an owed claim', () => {
  for (const change of [
    (x) => (x.recordReceipts = [{ ...receipt, witnessed: false }]),
    (x) =>
      (x.finalLedger = row({
        ...entry,
        predicate: { ...entry.predicate, pass: 'example-other-pass' },
      })),
    (x) =>
      (x.finalLedger = row({ ...entry, predicateType: 'example-ingested' })),
    (x) => (x.recordReceipts = []),
  ]) {
    const x = input();
    change(x);
    assert.equal(assessGrounding(x).groundingComplete, false);
  }
});
test('ledger rewrites and interrupted writes cannot pass', () => {
  const rewritten = input();
  rewritten.initialLedger = row({ example: 'old record' });
  assert.equal(assessGrounding(rewritten).status, 'invalidated');
  const partial = input();
  partial.finalLedger = Buffer.from('{"unfinished":');
  assert.equal(assessGrounding(partial).groundingComplete, false);
});
test('timeout or rejected tool cannot become success with otherwise valid records', () => {
  for (const change of [
    (x) => (x.turnStatus = 'interrupted'),
    (x) => (x.gateErrors = ['EXAMPLE_DENIED']),
  ]) {
    const x = input();
    change(x);
    assert.equal(assessGrounding(x).status, 'failed');
  }
});
test('brief parsing requires withheld scope and a valid owed set', () => {
  const payload = {
    floor: 1,
    owed: ['C1'],
    claims: [{ id: 'C1', proposition: 'EXAMPLE DATA', scope: 'WITHHELD' }],
  };
  const wrap = (x) => ({
    content: [{ type: 'text', text: JSON.stringify(x) }],
  });
  assert.deepEqual(parseBrief(wrap(payload)).owed, ['C1']);
  assert.throws(() => parseBrief(wrap({ ...payload, owed: ['C9'] })));
  assert.throws(() =>
    parseBrief(
      wrap({
        ...payload,
        claims: [{ ...payload.claims[0], scope: 'author details' }],
      }),
    ),
  );
  assert.throws(() => parseBrief({ isError: true }));
});
