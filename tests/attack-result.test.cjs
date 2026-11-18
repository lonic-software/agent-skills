'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path');
const { assessAttack } = require('../codex/runtime/attack-result.cjs');
function machineReport(kind) {
  return {
    isError: !!kind,
    content: [
      {
        type: 'text',
        text:
          `machine-checked: ${kind ? '1 failing (' + kind + ' 1)' : 'clean'} — grammar, claims out of proof\n` +
          (kind ? `  - [${kind}] C1: EXAMPLE revised claim\n` : '') +
          '\nhuman-owed: every READING/OBSERVED/ATTESTED row — none of this is settled by a passing check\n\nchecked by tetel EXAMPLE test build\n',
      },
    ],
  };
}
function input() {
  const memo = path.resolve('EXAMPLE-memo.md');
  return {
    before: {
      floor: 1,
      claims: [{ id: 'C1', proposition: 'EXAMPLE' }],
      owed: ['C1'],
    },
    after: {
      floor: 1,
      claims: [{ id: 'C1', proposition: 'EXAMPLE' }],
      owed: ['C1'],
    },
    turnStatus: 'completed',
    initialDigest: 'EXAMPLE-DIGEST',
    finalDigest: 'EXAMPLE-DIGEST',
    initialLedger: Buffer.alloc(0),
    finalLedger: Buffer.alloc(0),
    recordReceipts: [],
    memo,
    memoText: 'EXAMPLE ONE\nEXAMPLE TWO\n',
    audit: [
      { kind: 'forward', name: 'check', arguments: { file: memo } },
      { kind: 'result', name: 'check', result: machineReport() },
      {
        kind: 'forward',
        name: 'look',
        arguments: { path: memo, lines: { start: 1, end: 2 } },
      },
      {
        kind: 'result',
        name: 'look',
        result: {
          content: [
            {
              type: 'text',
              text: '==> EXAMPLE <==\nEXAMPLE ONE\nEXAMPLE TWO\n',
            },
          ],
        },
      },
    ],
    report: {
      targets: ['EXAMPLE decision'],
      findings: [],
      missingClaims: [],
      worthwhile: { answer: 'yes', reason: 'EXAMPLE supported decision' },
      routed: [],
      unresolved: [],
    },
  };
}
test('completed attack is distinct from grounding and design approval', () => {
  const r = assessAttack(input());
  assert.equal(r.attackComplete, true);
  assert.equal(r.designApproved, false);
});
test('unread memo lines and truncated tool output prevent completion', () => {
  for (const mutate of [
    (x) => (x.audit[2].arguments.lines.end = 1),
    (x) => (x.audit[3].result.content[0].text = 'EXAMPLE ONE'),
  ]) {
    const x = input();
    mutate(x);
    assert.equal(assessAttack(x).attackComplete, false);
  }
});
test('missing check, missing judgment and unwitnessed findings fail', () => {
  for (const mutate of [
    (x) => x.audit.splice(0, 2),
    (x) => delete x.report.worthwhile,
    (x) =>
      x.report.findings.push({
        claim: 'C1',
        verdict: 'refutes',
        fact: 'F1',
        changesBuild: true,
        explanation: 'EXAMPLE',
      }),
  ]) {
    const x = input();
    mutate(x);
    assert.equal(assessAttack(x).attackComplete, false);
  }
});
test('changed memo and a failed model turn cannot pass', () => {
  for (const mutate of [
    (x) => (x.finalDigest = 'CHANGED'),
    (x) => (x.turnStatus = 'failed'),
  ]) {
    const x = input();
    mutate(x);
    assert.equal(assessAttack(x).attackComplete, false);
  }
});
test('missing-claim findings must cite a fact actually captured in this pass', () => {
  const x = input();
  x.report.missingClaims.push({
    decision: 'EXAMPLE recommendation',
    neededProposition: 'EXAMPLE precondition',
    facts: ['F1'],
    changesBuild: true,
  });
  assert.equal(assessAttack(x).attackComplete, false);
  x.audit.push(
    { kind: 'forward', name: 'fact', arguments: { workspace: 'EXAMPLE' } },
    {
      kind: 'result',
      name: 'fact',
      result: { structuredContent: { id: 'F1' } },
    },
  );
  assert.equal(assessAttack(x).attackComplete, true);
});
test('failing machine-check reports count as checked without approving the design', () => {
  for (const kind of ['out-of-proof', 'ungrounded']) {
    const x = input();
    x.audit[1].result = machineReport(kind);
    const r = assessAttack(x);
    assert.deepEqual(r.reasons, []);
    assert.equal(r.attackComplete, true);
    assert.equal(r.designApproved, false);
  }
});
test('paged failing reports and CRLF reports also count as checked', () => {
  for (const paged of [false, true]) {
    const x = input();
    x.audit[1].result = machineReport('out-of-proof');
    if (paged)
      x.audit[1].result.content[0].text =
        "[tetel: showed check rows 1-1 of 2; not shown: qualified 1; continue with from: 2 — a reply is held to 12000 bytes, and if a later page's total differs the memo changed between pages: start again without `from`]\n" +
        x.audit[1].result.content[0].text;
    else
      x.audit[1].result.content[0].text =
        x.audit[1].result.content[0].text.replace(/\n/g, '\r\n');
    assert.equal(assessAttack(x).attackComplete, true);
  }
});
test('a refusal, malformed report or foreign-memo check never counts as checked', () => {
  for (const mutate of [
    (x) =>
      (x.audit[1].result = {
        isError: true,
        content: [{ type: 'text', text: 'EXAMPLE transport error' }],
      }),
    (x) => (x.audit[1].result = { content: [] }),
    (x) =>
      (x.audit[1].result = {
        content: [{ type: 'text', text: 'machine-checked: clean' }],
      }),
    (x) => (x.audit[0].arguments.file = path.resolve('OTHER-memo.md')),
    (x) =>
      (x.audit[1].result = {
        isError: true,
        content: [
          { type: 'text', text: 'no tetel rows found — nothing was checked' },
        ],
      }),
  ]) {
    const x = input();
    mutate(x);
    const r = assessAttack(x);
    assert.equal(r.attackComplete, false);
    assert.ok(
      r.reasons.includes('The attacker did not run check on the assigned memo'),
    );
  }
});
test('a valid failing check does not erase integrity or record failures', () => {
  for (const mutate of [
    (x) => (x.gateErrors = ['EXAMPLE gate failure']),
    (x) => (x.finalDigest = 'CHANGED'),
    (x) => (x.turnStatus = 'failed'),
    (x) => (x.recordReceipts = [{ recorded: false }]),
    (x) => (x.finalLedger = Buffer.from('{"EXAMPLE":"unattributed"}\n')),
  ]) {
    const x = input();
    x.audit[1].result = machineReport('out-of-proof');
    mutate(x);
    assert.equal(assessAttack(x).attackComplete, false);
  }
});
test('inconsistent machine rows and impossible page ranges are malformed reports', () => {
  for (const transform of [
    (text) => text.replace(/^  - .*\n/m, ''),
    (text) => text.replace('  - [out-of-proof]', '  - [grammar]'),
    (text) => '[tetel: showed check rows 2-1 of 2; not shown: none]\n' + text,
    (text) => '[tetel: showed check rows 1-3 of 2; not shown: none]\n' + text,
  ]) {
    const x = input();
    x.audit[1].result = machineReport('out-of-proof');
    x.audit[1].result.content[0].text = transform(
      x.audit[1].result.content[0].text,
    );
    const r = assessAttack(x);
    assert.equal(r.attackComplete, false);
    assert.ok(
      r.reasons.includes('The attacker did not run check on the assigned memo'),
    );
  }
});

function pagedInput() {
  const x = input(),
    lines = Array.from(
      { length: 228 },
      (_, i) => 'EXAMPLE MEMO LINE ' + (i + 1),
    );
  x.memoText = lines.join('\n') + '\n';
  x.audit = x.audit.slice(0, 2);
  const add = (start, end, shownEnd = end) =>
    x.audit.push(
      {
        kind: 'forward',
        name: 'look',
        arguments: { path: x.memo, lines: { start, end } },
      },
      {
        kind: 'result',
        name: 'look',
        result: {
          content: [
            {
              type: 'text',
              text:
                '==> ' +
                x.memo +
                ' <==\n' +
                (shownEnd < end
                  ? `[tetel: showed lines ${start}-${shownEnd} of 228; continue with lines ${shownEnd + 1}-${end} — a reply is held to 32768 bytes]\n`
                  : '') +
                lines.slice(start - 1, shownEnd).join('\n') +
                '\n',
            },
          ],
        },
      },
    );
  add(1, 150);
  add(151, 200, 199);
  add(200, 228);
  return x;
}
test('paged memo prefix 151-199 plus continuation 200-228 satisfies the 151-200 request', () => {
  for (const crlf of [false, true]) {
    const x = pagedInput();
    if (crlf)
      for (const e of x.audit)
        if (e.name === 'look' && e.kind === 'result')
          e.result.content[0].text = e.result.content[0].text.replace(
            /\n/g,
            '\r\n',
          );
    const r = assessAttack(x);
    assert.equal(r.attackComplete, true);
    assert.deepEqual(r.reasons, []);
  }
});
test('paged memo credit requires actual complete lines and valid declared bounds', () => {
  for (const mutate of [
    (x) => x.audit.splice(-2),
    (x) =>
      (x.audit[5].result.content[0].text =
        x.audit[5].result.content[0].text.replace(
          'EXAMPLE MEMO LINE 180\n',
          '',
        )),
    (x) =>
      (x.audit[5].result.content[0].text =
        x.audit[5].result.content[0].text.replace(
          '151-199 of 228',
          '150-199 of 228',
        )),
    (x) =>
      (x.audit[5].result.content[0].text =
        x.audit[5].result.content[0].text.replace(
          '151-199 of 228',
          '151-201 of 228',
        )),
    (x) =>
      (x.audit[5].result.content[0].text =
        x.audit[5].result.content[0].text.replace('of 228;', 'of 229;')),
    (x) =>
      (x.audit[5].result.content[0].text =
        x.audit[5].result.content[0].text.replace('151-199 of', '151-nope of')),
    (x) =>
      (x.audit[5].result.content[0].text =
        x.audit[5].result.content[0].text.replace(
          'EXAMPLE MEMO LINE 199\n',
          'EXAMPLE MEMO LINE 199 truncated\n',
        )),
    (x) => (x.audit[5].result.isError = true),
  ]) {
    const x = pagedInput();
    mutate(x);
    const r = assessAttack(x);
    assert.equal(r.attackComplete, false);
    assert.ok(
      r.reasons.includes('The attacker did not capture the complete memo'),
    );
  }
});
test('pagination-like text inside a completely returned memo is ordinary memo content', () => {
  const x = input();
  x.memoText = '[tetel: showed lines EXAMPLE quoted syntax]\nEXAMPLE TWO\n';
  x.audit[3].result.content[0].text = '==> EXAMPLE <==\n' + x.memoText;
  assert.equal(assessAttack(x).attackComplete, true);
});
