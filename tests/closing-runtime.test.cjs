'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  vm = require('node:vm'),
  { createRequire } = require('node:module');
const runtime = path.resolve(__dirname, '../codex/runtime');
function load(name, overrides = {}, globals = {}) {
  const filename = path.join(runtime, name),
    requireReal = createRequire(filename),
    module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, 'utf8'),
    {
      module,
      exports: module.exports,
      require: (n) =>
        Object.hasOwn(overrides, n) ? overrides[n] : requireReal(n),
      __dirname: runtime,
      __filename: filename,
      process,
      Buffer,
      AbortController,
      console: { log() {} },
      setTimeout,
      clearTimeout,
      ...globals,
    },
    { filename },
  );
  return module.exports;
}
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-closing-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('B19 ordinary CLI forwards 12-hour config and explicit override without a hidden clamp', async (t) => {
  const dir = temp(t),
    config = path.join(dir, 'runtime.json'),
    authority = path.join(dir, 'authority.txt');
  fs.writeFileSync(
    config,
    JSON.stringify({
      schema: 1,
      codex: 'EXAMPLE',
      model: 'EXAMPLE',
      timeoutMs: 43200000,
    }),
  );
  fs.writeFileSync(authority, 'EXAMPLE local only');
  const seen = [],
    cli = load('queue.cjs', {
      './queue-controller.cjs': {
        runQueue: async (o) => {
          seen.push(o.timeoutMs);
          return { status: 'complete' };
        },
      },
    });
  const args = [
    '--config',
    config,
    '--project',
    dir,
    '--queue',
    'task.md',
    '--authority-file',
    authority,
    '--threshold',
    '60',
  ];
  assert.equal(await cli.main(args), 0);
  assert.equal(await cli.main([...args, '--timeout-ms', '7200000']), 0);
  assert.deepEqual(seen, [43200000, 7200000]);
});
test('B19 native-session path arms the full 12-hour timer, then interrupts and stops on expiry without a native process', async (t) => {
  const dir = temp(t),
    entry = path.join(dir, 'SKILL.md');
  fs.writeFileSync(entry, 'EXAMPLE');
  let callbacks,
    closed = 0;
  const timers = [],
    requests = [];
  const rpc = (exe, args, opts) => {
    callbacks = opts;
    return {
      notify() {},
      close() {
        closed++;
      },
      async call(method, params) {
        requests.push(method);
        if (method === 'skills/list')
          return { data: [{ skills: [{ path: entry, enabled: true }] }] };
        if (method === 'thread/start') return { thread: { id: 't' } };
        if (method === 'turn/start') return { turn: { id: 'u' } };
        if (method === 'turn/interrupt') {
          callbacks.onMessage({
            method: 'turn/completed',
            params: { threadId: 't', turn: { status: 'interrupted' } },
          });
          return {};
        }
        return {};
      },
    };
  };
  const c = load(
    'queue-controller.cjs',
    { './rpc-client.cjs': { rpc } },
    {
      setTimeout: (fn, ms) => {
        timers.push(ms);
        return setTimeout(fn, ms === 43200000 ? 1 : ms);
      },
    },
  );
  const result = await c.nativeSession(
    {
      file: path.join(dir, 'descriptor.json'),
      decisionsFile: path.join(dir, 'decisions.json'),
      project: dir,
      step: 1,
      entrySkill: 'powerup',
      itemId: 'one',
      queue: 'EXAMPLE',
      exclusions: [],
    },
    { entrySkillFile: entry, model: 'EXAMPLE', timeoutMs: 43200000 },
  );
  assert.equal(result.turnStatus, 'failed');
  assert.match(result.error, /session timed out/);
  assert.equal(timers[0], 43200000);
  assert.ok(requests.includes('turn/interrupt'));
  assert.equal(closed, 1);
});
for (const mode of ['grounder', 'attacker'])
  test(
    'E7 actual ' +
      mode +
      ' runner timeout names role and preserves a failed result without native RPC',
    async (t) => {
      const dir = temp(t),
        memo = path.join(dir, 'memo.md');
      fs.writeFileSync(memo, 'EXAMPLE\n');
      fs.mkdirSync(memo + '.tetel');
      const job = {
        mode,
        memo,
        repo: dir,
        pin: 'a'.repeat(40),
        codex: 'EXAMPLE',
        tetel: 'EXAMPLE',
        model: 'EXAMPLE',
        workspace: 'EXAMPLE',
        workDir: path.join(dir, 'work'),
        jobPath: path.join(dir, 'job.json'),
        audit: path.join(dir, 'audit.jsonl'),
        events: path.join(dir, 'events.jsonl'),
        result: path.join(dir, 'result.json'),
      };
      const allowed = require('../codex/runtime/bound-grounder-gate.cjs')
        .TOOL_SETS[mode];
      let opened = 0,
        closed = 0,
        turns = 0;
      const rpc = (exe, args, opts) => {
        opened++;
        return {
          notify() {},
          close() {
            closed++;
          },
          async call(method) {
            if (method === 'config/read') return { config: {} };
            if (method === 'skills/list') return { data: [] };
            if (method === 'mcpServerStatus/list')
              return {
                data: [
                  {
                    name: 'grounder',
                    tools: Object.fromEntries(allowed.map((k) => [k, {}])),
                  },
                ],
              };
            if (method === 'tools/call')
              return { structuredContent: { floor: 1, claims: [], owed: [] } };
            if (method === 'thread/start')
              return { thread: { id: 't' }, instructionSources: [] };
            if (method === 'turn/start') {
              turns++;
              return { turn: { id: 'u' } };
            }
            if (method === 'turn/interrupt') {
              opts.onMessage({
                method: 'turn/completed',
                params: { threadId: 't', turn: { status: 'interrupted' } },
              });
              return {};
            }
            return {};
          },
        };
      };
      const run = load(
        'run-isolated-grounder.cjs',
        { './rpc-client.cjs': { rpc } },
        { setTimeout: (fn, ms) => setTimeout(fn, ms === 1234 ? 1 : ms) },
      ).runEvidence;
      await assert.rejects(
        run(job, { timeoutMs: 1234 }),
        new RegExp(mode + ' evidence pass timed out after 1234 ms'),
      );
      const result = JSON.parse(fs.readFileSync(job.result));
      assert.equal(result.turnStatus, 'failed');
      assert.match(result.error, new RegExp(mode));
      assert.equal(result.interruptionObserved, true);
      assert.equal(opened, 3);
      assert.equal(closed, 3);
      assert.equal(turns, 1);
    },
  );
test('B18 complete brief byte boundary, UTF-8, tetel cut marker, and compact fallback', () => {
  const { parseBrief } = require('../codex/runtime/grounding-result.cjs');
  const brief = {
    floor: 1,
    claims: [{ id: 'C1', proposition: '', scope: 'WITHHELD' }],
    owed: ['C1'],
  };
  const size = Buffer.byteLength(JSON.stringify(brief));
  brief.claims[0].proposition = 'x'.repeat(32768 - size);
  const text = JSON.stringify(brief);
  assert.equal(Buffer.byteLength(text), 32768);
  assert.equal(
    parseBrief({ content: [{ type: 'text', text }] }).claims.length,
    1,
  );
  assert.equal(
    parseBrief({ structuredContent: brief, content: [{ type: 'text', text }] })
      .claims.length,
    1,
  );
  brief.claims[0].proposition += 'é';
  assert.throws(
    () => parseBrief({ structuredContent: brief }),
    /BRIEF_REPLY_TOO_LARGE.*32768.*Split claims/,
  );
  const cut =
    text.slice(0, 100) +
    '\n[tetel: this reply was cut to its first 100 of 40000 bytes to stay within the 32768-byte reply bound]';
  assert.throws(
    () => parseBrief({ content: [{ type: 'text', text: cut }] }),
    /BRIEF_REPLY_TOO_LARGE/,
  );
  assert.throws(
    () => parseBrief({ content: [{ type: 'text', text: '{"floor":' }] }),
    /BRIEF_REPLY_INVALID_JSON/,
  );
  assert.throws(
    () =>
      parseBrief({ structuredContent: { floor: 1, claims: [], owed: ['C9'] } }),
    /Invalid owed list/,
  );
});
test('B4 ordinary RPC preserves routing environment and an explicit override; no shell effect is claimed', () => {
  const { EventEmitter } = require('node:events'),
    { PassThrough } = require('node:stream'),
    seen = [];
  const old = process.env.CODEX_WINDOWS_REGISTERED_CORE;
  process.env.CODEX_WINDOWS_REGISTERED_CORE = 'EXAMPLE_PARENT';
  try {
    const rpc = load('rpc-client.cjs', {
      'node:child_process': {
        spawn: (exe, args, options) => {
          seen.push(options.env.CODEX_WINDOWS_REGISTERED_CORE);
          const p = new EventEmitter();
          p.stdout = new PassThrough();
          p.stderr = new PassThrough();
          p.stdin = new PassThrough();
          p.kill = () => {};
          return p;
        },
      },
    }).rpc;
    rpc('EXAMPLE', []).close();
    rpc('EXAMPLE', [], {
      env: { CODEX_WINDOWS_REGISTERED_CORE: 'EXAMPLE_OVERRIDE' },
    }).close();
    assert.deepEqual(seen, ['EXAMPLE_PARENT', 'EXAMPLE_OVERRIDE']);
  } finally {
    if (old === undefined) delete process.env.CODEX_WINDOWS_REGISTERED_CORE;
    else process.env.CODEX_WINDOWS_REGISTERED_CORE = old;
  }
});
