'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { runAttackPair } = require('../codex/runtime/attack-pair.cjs');
const { createBoundGate } = require('../codex/runtime/bound-grounder-gate.cjs');
const { artifactDigest } = require('../codex/runtime/grounding-result.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-pair-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'source');
  fs.mkdirSync(repo);
  const memo = path.join(root, 'memo.md');
  fs.writeFileSync(memo, 'EXAMPLE DECISION\n');
  fs.mkdirSync(memo + '.tetel');
  let count = 0;
  const createJob = () => {
    const run = path.join(root, 'pass-' + ++count);
    fs.mkdirSync(run);
    return {
      timeoutMs: 1000,
      job: {
        mode: 'attacker',
        memo,
        repo,
        pin: 'a'.repeat(40),
        workspace: 'EXAMPLE-' + count,
        jobPath: path.join(run, 'job.json'),
        result: path.join(run, 'result.json'),
      },
    };
  };
  return { root, repo, memo, createJob };
}
const baseline = {
  content: [
    {
      type: 'text',
      text: 'machine-checked: clean — EXAMPLE INITIAL CHECK\n\nhuman-owed: every READING/OBSERVED/ATTESTED row — none of this is settled by a passing check\n\nchecked by tetel EXAMPLE test build\n',
    },
  ],
};
test('two fresh passes see the same pre-pair check while recording against the actual memo', async (t) => {
  const x = fixture(t),
    seen = [];
  let checks = 0;
  const result = await runAttackPair(
    {},
    {
      createJob: x.createJob,
      captureCheck: async () => {
        checks++;
        return checks === 1
          ? baseline
          : {
              content: [
                { type: 'text', text: 'EXAMPLE CURRENT CHECK WITH FINDINGS' },
              ],
            };
      },
      runEvidence: async (job) => {
        seen.push(job);
        assert.equal(job.memo, x.memo);
        assert.deepEqual(job.attackBaseline.result, baseline);
        fs.appendFileSync(
          x.memo + '.evidence.jsonl',
          JSON.stringify({ example: job.workspace }) + '\n',
        );
        return {
          threadId: job.workspace,
          completion: { attackComplete: true },
        };
      },
    },
  );
  assert.equal(result.pairComplete, true);
  assert.equal(result.designApproved, false);
  assert.notEqual(seen[0].workspace, seen[1].workspace);
  assert.equal(checks, 2);
  assert.match(JSON.stringify(result.currentCheck), /WITH FINDINGS/);
  assert.equal(fs.existsSync(x.memo + '.lonic-attack-pair.lock'), false);
});
test('incomplete first pass stops the pair and retains its evidence', async (t) => {
  const x = fixture(t);
  let count = 0;
  const result = await runAttackPair(
    {},
    {
      createJob: x.createJob,
      captureCheck: async () => baseline,
      runEvidence: async () => {
        count++;
        fs.writeFileSync(
          x.memo + '.evidence.jsonl',
          'EXAMPLE partial record\n',
        );
        return { completion: { attackComplete: false } };
      },
    },
  );
  assert.equal(count, 1);
  assert.equal(result.pairComplete, false);
  assert.match(result.error, /incomplete/);
  assert.equal(
    fs.readFileSync(x.memo + '.evidence.jsonl', 'utf8'),
    'EXAMPLE partial record\n',
  );
});
test('a memo change prevents the second initial attack', async (t) => {
  const x = fixture(t);
  let count = 0;
  const result = await runAttackPair(
    {},
    {
      createJob: x.createJob,
      captureCheck: async () => baseline,
      runEvidence: async () => {
        count++;
        fs.appendFileSync(x.memo, 'EXAMPLE changed\n');
        return { completion: { attackComplete: true } };
      },
    },
  );
  assert.equal(count, 1);
  assert.equal(result.pairComplete, false);
  assert.match(result.error, /changed/);
});
test('peer ledger findings are not returned by check and direct ledger reads are denied', async (t) => {
  const x = fixture(t),
    job = {
      ...x.createJob().job,
      attackBaseline: { digest: artifactDigest(x.memo), result: baseline },
    };
  const calls = [],
    audit = [];
  const gate = createBoundGate(
    {
      tools: [
        'check',
        'look',
        'run',
        'fact',
        'record',
        'query',
        'workspaces',
      ].map((name) => ({ name })),
    },
    async (m, p) => {
      calls.push(p);
      return {
        content: [
          {
            type: 'text',
            text:
              p.name === 'run'
                ? JSON.stringify({ exit_code: 0, output: job.pin })
                : 'EXAMPLE SECRET PEER FINDING',
          },
        ],
      };
    },
    job,
    (e) => audit.push(e),
  );
  const call = (name, args) =>
    gate.request('tools/call', { name, arguments: args });
  const checked = await call('check', { file: x.memo });
  assert.match(JSON.stringify(checked), /EXAMPLE INITIAL CHECK/);
  assert.doesNotMatch(JSON.stringify(checked), /SECRET PEER/);
  assert.equal(calls.length, 0);
  await call('run', {
    workspace: job.workspace,
    command: ['git', '-C', x.repo, 'rev-parse', 'HEAD'],
  });
  fs.writeFileSync(x.memo + '.evidence.jsonl', 'EXAMPLE SECRET PEER FINDING');
  const denied = await call('look', {
    workspace: job.workspace,
    path: x.memo + '.evidence.jsonl',
  });
  assert.equal(denied.isError, true);
  assert.doesNotMatch(JSON.stringify(denied), /SECRET PEER/);
  assert.equal(calls.length, 1);
  assert.equal(audit.filter((e) => e.kind === 'read-denied').length, 1);
  await call('check', { file: x.memo });
  assert.equal(audit.filter((e) => e.kind === 'baseline-check').length, 2);
});
test('baseline check refuses a changed memo', async (t) => {
  const x = fixture(t),
    job = {
      ...x.createJob().job,
      attackBaseline: { digest: artifactDigest(x.memo), result: baseline },
    };
  const gate = createBoundGate(
    {
      tools: [
        'check',
        'look',
        'run',
        'fact',
        'record',
        'query',
        'workspaces',
      ].map((name) => ({ name })),
    },
    async () => {
      throw Error('must not forward');
    },
    job,
    () => {},
  );
  fs.appendFileSync(x.memo, 'EXAMPLE change');
  await assert.rejects(
    gate.request('tools/call', { name: 'check', arguments: { file: x.memo } }),
    /changed/,
  );
});
