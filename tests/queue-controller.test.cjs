'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { runQueue } = require('../codex/runtime/queue-controller.cjs');
const { createQueueTools } = require('../codex/runtime/queue-server.cjs');
const { readCheckpoint } = require('../codex/runtime/queue-checkpoint.cjs');
function usage(percent = 25) {
  const now = Date.now();
  return {
    observedAt: now,
    response: {
      accountId: 'EXAMPLE-ACCOUNT',
      ordinaryUsageAllowed: true,
      rateLimits: {
        limitId: 'codex',
        primary: {
          windowDurationMins: 300,
          usedPercent: 10,
          resetsAt: Math.floor(now / 1000) + 3600,
        },
        secondary: {
          windowDurationMins: 10080,
          usedPercent: percent,
          resetsAt: 1900000000,
        },
      },
    },
  };
}
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-queue-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  return {
    codex: 'EXAMPLE-codex',
    model: 'EXAMPLE-model',
    project,
    queue: 'EXAMPLE-QUEUE.txt',
    authority: 'Local example edits only; no publication or installation',
    entrySkill: 'queue-run',
    exclusions: ['Never publish'],
    absolute: 60,
    runRoot: path.join(root, 'runs'),
    maxSteps: 3,
    handoffDelayMs: 0,
  };
}
function state(step, status = 'continue') {
  return {
    status,
    reason: 'EXAMPLE boundary ' + step,
    itemId: 'EXAMPLE-' + step,
    resumePrompt: '$queue-run Re-read the queue; EXAMPLE checkpoint ' + step,
    sourceState: [{ path: 'EXAMPLE-untracked.txt', state: 'untracked' }],
    completedChecks: ['EXAMPLE check passed'],
    openFindings: ['EXAMPLE unresolved finding'],
    blockedItems: [],
    nextActions: ['Re-read current source and queue'],
  };
}

test('B19 controller default is two hours and explicit sessions can reach twelve hours', async (t) => {
  for (const timeout of [undefined, 1000, 900001, 7200000, 43200000]) {
    const options = setup(t);
    if (timeout !== undefined) options.timeoutMs = timeout;
    let calls = 0;
    const result = await runQueue(options, {
      readUsage: async () => usage(),
      runSession: async (d, o) => {
        calls++;
        assert.equal(o.timeoutMs, timeout ?? 7200000);
        return { turnStatus: 'failed', error: 'EXAMPLE deadline' };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.status, 'needs-reconciliation');
  }
  for (const timeoutMs of [0, 999, 43200001, Infinity, NaN, 1.5])
    await assert.rejects(
      runQueue(
        { ...setup(t), timeoutMs },
        { readUsage: () => assert.fail('invalid bound must not read usage') },
      ),
      /Invalid project or run bound/,
    );
});
test('two sessions retain authority and unresolved state through a claimed checkpoint', async (t) => {
  const options = setup(t),
    seen = [];
  const readUsage = async () => usage();
  const report = await runQueue(options, {
    readUsage,
    runSession: async (d, o) => {
      seen.push(o);
      const tools = createQueueTools(d, readUsage);
      await tools.handoff({
        ...state(d.step, d.step === 1 ? 'continue' : 'done'),
        authority: 'Untrusted expansion ignored',
      });
      return { threadId: 'EXAMPLE-thread-' + d.step, turnStatus: 'completed' };
    },
  });
  assert.equal(report.status, 'complete');
  assert.equal(report.sessions.length, 2);
  assert.match(seen[1].resumePrompt, /EXAMPLE checkpoint 1/);
  const delivered = JSON.parse(seen[1].resumePrompt);
  assert.equal(delivered.data.openFindings[0], 'EXAMPLE unresolved finding');
  assert.equal(delivered.data.sourceState[0].state, 'untracked');
  assert.deepEqual(delivered.data.exclusions, options.exclusions);
  assert.equal(delivered.checkpointFile, report.sessions[0].checkpoint);
  const saved = readCheckpoint(report.sessions[0].checkpoint);
  assert.equal(saved.data.authority, options.authority);
  assert.equal(saved.data.openFindings[0], 'EXAMPLE unresolved finding');
  assert.equal(fs.existsSync(report.sessions[0].checkpoint + '.claimed'), true);
});
test('budget crossing during a session stops before another session starts', async (t) => {
  const options = setup(t);
  let high = false,
    calls = 0;
  const readUsage = async () => usage(high ? 60 : 25);
  const report = await runQueue(options, {
    readUsage,
    runSession: async (d) => {
      calls++;
      high = true;
      await createQueueTools(d, readUsage).handoff(state(d.step));
      return { turnStatus: 'completed' };
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.status, 'stopped');
  assert.equal(report.reason, 'weekly-threshold-reached');
});
test('missing weekly data or an already reached threshold starts no session', async (t) => {
  for (const variant of ['missing', 'reached']) {
    const options = setup(t);
    let called = false;
    const report = await runQueue(options, {
      readUsage: async () => {
        const x = usage(60);
        if (variant === 'missing') x.response.rateLimits.secondary = null;
        return x;
      },
      runSession: async () => {
        called = true;
      },
    });
    assert.equal(called, false);
    assert.equal(report.status, 'stopped');
  }
});
test('failed, incomplete and interactive sessions never chain', async (t) => {
  for (const variant of ['failed', 'missing-handoff', 'interactive']) {
    const options = setup(t);
    let calls = 0;
    const report = await runQueue(options, {
      readUsage: async () => usage(),
      runSession: async () => {
        calls++;
        return {
          turnStatus: variant === 'failed' ? 'failed' : 'completed',
          interactiveRequests:
            variant === 'interactive' ? [{ method: 'EXAMPLE-approval' }] : [],
        };
      },
    });
    assert.equal(calls, 1);
    assert.equal(report.status, 'needs-reconciliation');
  }
});
test('a usage read failure persists a stop instead of silently restoring budget', async (t) => {
  const options = setup(t);
  let fail = false;
  const readUsage = async () => {
    if (fail) throw Error('EXAMPLE network failure');
    return usage();
  };
  const report = await runQueue(options, {
    readUsage,
    runSession: async (d) => {
      fail = true;
      const tools = createQueueTools(d, readUsage);
      await tools.handoff(state(d.step));
      return { turnStatus: 'completed' };
    },
  });
  assert.equal(report.status, 'stopped');
  assert.equal(report.reason, 'usage-read-failed');
});
test('a second handoff from the same session is rejected', async (t) => {
  const options = setup(t),
    readUsage = async () => usage();
  const report = await runQueue(options, {
    readUsage,
    runSession: async (d) => {
      const tools = createQueueTools(d, readUsage);
      await tools.handoff(state(d.step, 'done'));
      await assert.rejects(tools.handoff(state(d.step)), /already exists/);
      return { turnStatus: 'completed' };
    },
  });
  assert.equal(report.status, 'complete');
});
test('two queue controllers cannot consume the same project concurrently', async (t) => {
  const options = setup(t);
  let release, entered;
  const ready = new Promise((r) => (entered = r)),
    wait = new Promise((r) => (release = r));
  const first = runQueue(options, {
    readUsage: async () => usage(),
    runSession: async () => {
      entered();
      await wait;
      return { turnStatus: 'failed' };
    },
  });
  await ready;
  try {
    await assert.rejects(
      runQueue(
        { ...options, queue: 'DIFFERENT-LOCATOR' },
        { readUsage: async () => usage() },
      ),
      { code: 'EEXIST' },
    );
  } finally {
    release();
    await first;
  }
});
test('explicit step bound stops a nonconverging queue', async (t) => {
  const options = { ...setup(t), maxSteps: 2 },
    readUsage = async () => usage();
  const report = await runQueue(options, {
    readUsage,
    runSession: async (d) => {
      await createQueueTools(d, readUsage).handoff(state(d.step));
      return { turnStatus: 'completed' };
    },
  });
  assert.equal(report.sessions.length, 2);
  assert.equal(report.status, 'step-limit');
});

test('linked run roots are refused before a session can write through them', async (t) => {
  const options = setup(t),
    target = path.join(options.project, 'target'),
    link = path.join(options.project, 'link');
  fs.mkdirSync(target);
  fs.symlinkSync(
    target,
    link,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    runQueue(
      { ...options, runRoot: link },
      {
        readUsage: async () => usage(),
        runSession: async () => {
          throw Error('must not start');
        },
      },
    ),
    /links/,
  );
  assert.deepEqual(fs.readdirSync(target), []);
});

test('bare powerup binds the same item across two phases and allows no queue traversal', async (t) => {
  const options = {
      ...setup(t),
      entrySkill: 'powerup',
      itemId: 'EXAMPLE-single-task',
    },
    readUsage = async () => usage();
  const report = await runQueue(options, {
    readUsage,
    runSession: async (d) => {
      await createQueueTools(d, readUsage).handoff({
        ...state(d.step, d.step === 1 ? 'continue' : 'done'),
        itemId: d.itemId,
        resumePrompt: '$powerup Continue the same EXAMPLE task',
      });
      return { turnStatus: 'completed' };
    },
  });
  assert.equal(report.status, 'complete');
  assert.equal(report.sessions.length, 2);
  assert.equal(
    readCheckpoint(report.sessions[1].checkpoint).data.itemId,
    options.itemId,
  );
});
test('cancelling a handoff leaves its checkpoint unclaimed and starts no next session', async (t) => {
  const options = setup(t),
    readUsage = async () => usage();
  const report = await runQueue(options, {
    readUsage,
    countdown: async () => false,
    runSession: async (d) => {
      await createQueueTools(d, readUsage).handoff(state(d.step));
      return { turnStatus: 'completed' };
    },
  });
  assert.equal(report.reason, 'handoff-cancelled');
  assert.equal(report.sessions.length, 1);
  assert.equal(
    fs.existsSync(report.sessions[0].checkpoint + '.claimed'),
    false,
  );
});

test('an operator refusal survives more than one phase handoff', async (t) => {
  const options = setup(t),
    readUsage = async () => usage();
  const report = await runQueue(options, {
    readUsage,
    runSession: async (d, o) => {
      if (d.step === 1)
        fs.writeFileSync(
          d.decisionsFile,
          JSON.stringify([
            {
              reason: 'answered',
              response: { decision: 'decline' },
              request: { params: { command: 'EXAMPLE refused action' } },
            },
          ]),
        );
      if (d.step === 3) assert.match(o.resumePrompt, /EXAMPLE refused action/);
      await createQueueTools(d, readUsage).handoff(
        state(d.step, d.step === 3 ? 'done' : 'continue'),
      );
      return { turnStatus: 'completed' };
    },
  });
  assert.equal(report.status, 'complete');
  assert.equal(
    readCheckpoint(report.sessions[2].checkpoint).data.operatorDecisions.length,
    1,
  );
});
