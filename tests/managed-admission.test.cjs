'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  accountFingerprint,
  enrollAccount,
  createManagedAdmission,
} = require('../codex/runtime/managed-admission.cjs');
const now = 1800000000000;
const selection = {
  model: 'EXAMPLE-model',
  provider: 'openai',
  effort: 'medium',
};
const digest = (value) =>
  crypto.createHash('sha256').update(value).digest('hex');
const instructions = () => ({
  complete: true,
  scopeKey: 'EXAMPLE-fixed-discovery',
  sources: [
    {
      key: 'ignored/AGENTS.md',
      identity: 'EXAMPLE-file-1',
      sha256: digest('instruction A'),
    },
    {
      key: 'host:developer',
      identity: 'EXAMPLE-grant-1',
      sha256: digest('instruction B'),
    },
  ],
});
const hooks = (scope) => ({
  complete: true,
  scope,
  errors: [],
  warnings: [],
  hooks: [],
});
function sample(id = 'EXAMPLE-account-A') {
  return {
    account: {
      account: { type: 'chatgpt', email: 'EXAMPLE-person@example.invalid' },
      workspaceRouting: {
        chatgptAccountId: id,
        backendOrigin: 'https://example.invalid',
      },
    },
    usage: {
      accountId: id,
      ordinaryUsageAllowed: true,
      rateLimits: {
        limitId: 'codex',
        primary: {
          windowDurationMins: 300,
          usedPercent: 10,
          resetsAt: now / 1000 + 3600,
        },
        secondary: {
          windowDurationMins: 10080,
          usedPercent: 25,
          resetsAt: now / 1000 + 604800,
        },
      },
    },
    observedAt: now,
    effective: { ...selection },
    instructions: instructions(),
    hooks: hooks('cwd'),
  };
}
const approved = () => ({
  schema: 1,
  algorithm: 'm2-account-v1',
  fingerprint: accountFingerprint(sample().account, sample().usage),
});
function setup(extra = {}) {
  const stops = [];
  const options = {
    mode: 'managed',
    enrollment: approved(),
    selection: { ...selection },
    instructions: instructions(),
    budget: { runId: 'EXAMPLE-run', absolute: 60 },
    now: () => now,
    onInterrupt: (code) => stops.push(code),
    ...extra,
  };
  return { guard: createManagedAdmission(options), stops, options };
}
function beforeThread(guard, value = sample()) {
  guard.initialAccountRead();
  return guard.sample('before-thread', value);
}
function preTurn(guard, value = sample()) {
  value.hooks = hooks('thread');
  return guard.sample('before-turn', value);
}
function running(guard) {
  assert.equal(beforeThread(guard).allowed, true);
  assert.equal(preTurn(guard).allowed, true);
  assert.equal(guard.beginTurn().allowed, true);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

test('explicit managed mode is required; absent enrollment cannot self-enroll', () => {
  for (const mode of [undefined, false, 'legacy'])
    assert.throws(() => setup({ mode }), /MANAGED_MODE_REQUIRED/);
  for (const enrollment of [
    undefined,
    {},
    { ...approved(), algorithm: 'unknown' },
  ])
    assert.throws(() => setup({ enrollment }), /ENROLLMENT_REQUIRED/);
});
test('fingerprint matches sorted M2 canonical definition and rejects inconsistent identity', () => {
  const s = sample();
  assert.equal(
    accountFingerprint(s.account, s.usage),
    digest(
      JSON.stringify({
        accountType: 'chatgpt',
        backendOrigin: 'https://example.invalid',
        routingAccountId: 'EXAMPLE-account-A',
        usageAccountId: 'EXAMPLE-account-A',
      }),
    ),
  );
  for (const mutate of [
    (s) => {
      s.usage.accountId = 'B';
    },
    (s) => {
      delete s.account.workspaceRouting;
    },
    (s) => {
      delete s.account.account.type;
    },
    (s) => {
      delete s.account.workspaceRouting.backendOrigin;
    },
  ]) {
    const value = sample();
    mutate(value);
    assert.throws(
      () => accountFingerprint(value.account, value.usage),
      /ACCOUNT_IDENTITY_INVALID/,
    );
  }
});
test('matching samples allow exactly one turn and ordered post-turn acceptance', () => {
  const { guard, stops } = setup();
  running(guard);
  assert.equal(guard.completeTurn('completed').allowed, true);
  assert.equal(guard.sample('after-turn', sample()).allowed, true);
  assert.equal(guard.status().phase, 'complete');
  assert.deepEqual(stops, []);
  assert.equal(guard.beginTurn().allowed, false);
});
for (const boundary of ['before-thread', 'before-turn', 'after-turn'])
  test('mismatch at ' + boundary + ' stops irreversibly', () => {
    const { guard, stops } = setup();
    if (boundary !== 'before-thread')
      assert.equal(beforeThread(guard).allowed, true);
    if (boundary === 'after-turn') {
      assert.equal(preTurn(guard).allowed, true);
      guard.beginTurn();
      guard.completeTurn('completed');
    }
    const value = sample('EXAMPLE-account-B');
    if (boundary === 'before-turn') value.hooks = hooks('thread');
    if (boundary === 'before-thread') guard.initialAccountRead();
    assert.equal(guard.sample(boundary, value).allowed, false);
    assert.equal(guard.status().reason, 'ACCOUNT_MISMATCH');
    assert.equal(stops.length, 1);
    assert.equal(guard.sample(boundary, sample()).allowed, false);
    assert.equal(guard.beginTurn().allowed, false);
  });
test('missing/out-of-order samples and uncompleted turns cannot authorize continuation', () => {
  for (const action of [
    (g) => preTurn(g),
    (g) => g.beginTurn(),
    (g) => g.sample('after-turn', sample()),
  ]) {
    const { guard } = setup();
    assert.equal(action(guard).allowed, false);
  }
  const { guard } = setup();
  running(guard);
  assert.equal(guard.completeTurn('failed').allowed, false);
  assert.equal(guard.sample('after-turn', sample()).allowed, false);
});
test('one startup notification is allowed; second or later stops even with same identity', () => {
  const first = setup().guard;
  assert.equal(first.accountUpdated().allowed, true);
  assert.equal(beforeThread(first).allowed, true);
  assert.equal(first.accountUpdated().allowed, false);
  const second = setup().guard;
  second.accountUpdated();
  assert.equal(second.accountUpdated().allowed, false);
  const none = setup().guard;
  beforeThread(none);
  assert.equal(none.accountUpdated().allowed, false);
  const fresh = setup().guard;
  assert.equal(fresh.accountUpdated().allowed, true);
});
test('startup allowance closes on the first account reply, before a delayed usage reply', () => {
  const { guard, stops } = setup();
  guard.accountUpdated();
  assert.equal(guard.initialAccountRead().allowed, true);
  assert.equal(guard.accountUpdated().allowed, false);
  assert.equal(stops.length, 1);
  assert.equal(guard.sample('before-thread', sample()).allowed, false);
  const missing = setup().guard;
  assert.equal(missing.sample('before-thread', sample()).allowed, false);
  const duplicate = setup().guard;
  duplicate.initialAccountRead();
  assert.equal(duplicate.initialAccountRead().allowed, false);
});
test('retired generation notifications and late results cannot affect a new generation', async () => {
  const old = setup(),
    fresh = setup(),
    pending = deferred();
  running(old.guard);
  const wait = old.guard.refreshUsage(() => pending.promise);
  old.guard.retire();
  assert.equal((await wait).allowed, false);
  old.guard.accountUpdated();
  pending.resolve({ response: sample().usage, observedAt: now });
  await Promise.resolve();
  assert.equal(beforeThread(fresh.guard).allowed, true);
  assert.deepEqual(fresh.stops, []);
});
test('every enabled hook including lonic filter is refused at both admission scopes', () => {
  for (const scope of ['cwd', 'thread'])
    for (const name of ['EXAMPLE-native', 'lonic-test-filter']) {
      const { guard } = setup();
      if (scope === 'thread') beforeThread(guard);
      const value = sample();
      value.hooks = {
        ...hooks(scope),
        hooks: [{ name, enabled: true, known: true }],
      };
      if (scope === 'cwd') guard.initialAccountRead();
      assert.equal(
        guard.sample(scope === 'cwd' ? 'before-thread' : 'before-turn', value)
          .allowed,
        false,
      );
      assert.equal(guard.status().reason, 'HOOKS_NOT_ADMISSIBLE');
    }
});
test('unknown, incomplete, erroneous or wrong-scope hook inventory refuses; known disabled hook passes', () => {
  for (const mutate of [
    (h) => {
      h.complete = false;
    },
    (h) => {
      h.errors = ['secret'];
    },
    (h) => {
      h.warnings = ['unknown'];
    },
    (h) => {
      delete h.hooks;
    },
    (h) => {
      h.scope = 'thread';
    },
    (h) => h.hooks.push({ enabled: false, known: false }),
    (h) => h.hooks.push({ known: true }),
  ]) {
    const { guard } = setup(),
      value = sample();
    mutate(value.hooks);
    assert.equal(beforeThread(guard, value).allowed, false);
  }
  const { guard } = setup(),
    value = sample();
  value.hooks.hooks.push({ enabled: false, known: true });
  assert.equal(beforeThread(guard, value).allowed, true);
});
test('instruction membership, bytes, identity and discovery scope are pinned at both boundaries', () => {
  for (const boundary of ['before-thread', 'before-turn'])
    for (const mutate of [
      (x) => {
        x.sources[0].sha256 = digest('same length changed');
      },
      (x) => {
        x.sources.pop();
      },
      (x) => {
        x.sources.push({
          key: 'extra',
          identity: 'other',
          sha256: digest('x'),
        });
      },
      (x) => {
        x.sources[0].identity = 'retargeted';
      },
      (x) => {
        x.scopeKey = 'different environment';
      },
      (x) => {
        x.complete = false;
      },
      (x) => {
        x.sources.push({ ...x.sources[0] });
      },
    ]) {
      const { guard } = setup(),
        value = sample();
      if (boundary === 'before-turn') {
        beforeThread(guard);
        value.hooks = hooks('thread');
      }
      mutate(value.instructions);
      if (boundary === 'before-thread') guard.initialAccountRead();
      assert.equal(guard.sample(boundary, value).allowed, false);
      assert.equal(guard.status().reason, 'INSTRUCTIONS_CHANGED');
    }
  const { guard } = setup(),
    value = sample();
  value.instructions.sources.reverse();
  assert.equal(beforeThread(guard, value).allowed, true);
});
test('mutable caller inputs cannot replace expected account, model or instruction baseline', () => {
  const { guard, options } = setup();
  options.enrollment.fingerprint = 'b'.repeat(64);
  options.selection.model = 'OTHER';
  options.instructions.sources.length = 0;
  assert.equal(beforeThread(guard).allowed, true);
  assert.equal(preTurn(guard).allowed, true);
});
test('effective model/provider/effort mismatch refuses without exporting observed values', () => {
  for (const key of ['model', 'provider', 'effort']) {
    const { guard } = setup(),
      value = sample();
    value.effective[key] = 'SECRET';
    assert.equal(beforeThread(guard, value).allowed, false);
    assert.doesNotMatch(JSON.stringify(guard.status()), /SECRET/);
  }
});
for (const reason of [
  'operator-refused',
  'operator-cancelled',
  'operator-unavailable',
  'operator-expired',
  'operator-text',
])
  test('stalled quota cannot delay ' + reason, async () => {
    const { guard, stops } = setup(),
      pending = deferred();
    running(guard);
    let calls = 0;
    const first = guard.refreshUsage(() => {
      calls++;
      return pending.promise;
    });
    const duplicate = guard.refreshUsage(() => {
      calls++;
      throw Error('must not run');
    });
    assert.equal(first, duplicate);
    assert.equal(calls, 1);
    guard.stop(reason);
    assert.equal(stops.length, 1);
    assert.equal(guard.status().stopped, true);
    assert.equal((await first).allowed, false);
    pending.resolve({ response: sample().usage, observedAt: now });
    await Promise.resolve();
    assert.equal(guard.completeTurn('completed').allowed, false);
    assert.equal(guard.status().reason, reason);
    assert.equal(calls, 1);
  });
test('successful refresh is single-flight and late failure after stop is sanitized', async () => {
  const { guard } = setup();
  running(guard);
  const pending = deferred();
  let count = 0;
  const first = guard.refreshUsage(() => {
    count++;
    return pending.promise;
  });
  const second = guard.refreshUsage(() => {
    count++;
    return pending.promise;
  });
  assert.equal(first, second);
  pending.resolve({ response: sample().usage, observedAt: now });
  assert.equal((await first).allowed, true);
  assert.equal(count, 1);
  const late = deferred();
  const wait = guard.refreshUsage(() => late.promise);
  guard.stop('operator-cancelled');
  assert.equal((await wait).allowed, false);
  late.reject(Error('SECRET raw account'));
  await Promise.resolve();
  assert.doesNotMatch(JSON.stringify(guard.status()), /SECRET/);
});
test('quota restrictions, expired readings and original reset/threshold remain enforced', async () => {
  for (const mutate of [
    (u) => {
      u.ordinaryUsageAllowed = false;
    },
    (u) => {
      u.rateLimits.secondary.usedPercent = 60;
    },
    (u) => {
      u.rateLimits.secondary.resetsAt += 2;
    },
    (u) => {
      u.accountId = 'OTHER';
    },
  ]) {
    const { guard } = setup();
    running(guard);
    const value = sample();
    mutate(value.usage);
    assert.equal(
      (
        await guard.refreshUsage(() => ({
          response: value.usage,
          observedAt: now,
        }))
      ).allowed,
      false,
    );
  }
  const { guard } = setup(),
    value = sample();
  value.observedAt = now - 60001;
  assert.equal(beforeThread(guard, value).allowed, false);
});
test('interrupt dispatch happens without awaiting it and callback errors never leak', async () => {
  const pending = deferred();
  const { guard } = setup({ onInterrupt: () => pending.promise });
  running(guard);
  guard.stop('operator-refused');
  assert.equal(guard.status().stopped, true);
  pending.reject(Error('SECRET'));
  await Promise.resolve();
  const other = setup({
    onInterrupt: () => {
      throw Error('SECRET');
    },
  }).guard;
  assert.doesNotThrow(() => other.stop('operator-refused'));
  assert.doesNotMatch(JSON.stringify(other.status()), /SECRET/);
});
function terminal(answer = 'yes') {
  const prompts = [];
  return {
    inputTTY: true,
    outputTTY: true,
    prompts,
    confirm: async (prompt) => {
      prompts.push(prompt);
      return answer;
    },
  };
}
test('enrollment displays recognizable identity only on TTY, saves only version and fingerprint', async () => {
  const tty = terminal(),
    saved = [];
  let reads = 0;
  const record = await enrollAccount({
    terminal: tty,
    readSample: async () => {
      reads++;
      return sample();
    },
    save: async (x) => saved.push(x),
  });
  assert.equal(reads, 2);
  assert.match(tty.prompts[0], /EXAMPLE-person@example.invalid/);
  assert.equal(tty.prompts.length, 1);
  assert.deepEqual(saved, [approved()]);
  assert.deepEqual(record, approved());
  assert.doesNotMatch(
    JSON.stringify(saved),
    /EXAMPLE-person|EXAMPLE-account|example.invalid/,
  );
});
test('non-TTY enrollment reads/displays/persists nothing', async () => {
  for (const flag of ['inputTTY', 'outputTTY']) {
    const tty = terminal();
    tty[flag] = false;
    let reads = 0,
      saves = 0;
    await assert.rejects(
      enrollAccount({
        terminal: tty,
        readSample: async () => {
          reads++;
          return sample();
        },
        save: async () => saves++,
      }),
      /INTERACTIVE_TERMINAL_REQUIRED/,
    );
    assert.equal(reads, 0);
    assert.equal(saves, 0);
    assert.deepEqual(tty.prompts, []);
  }
});
test('refused, absent-label, changed-account and failed enrollment never persist raw data', async () => {
  for (const variant of ['decline', 'missing', 'changed', 'throws']) {
    let reads = 0,
      saves = 0;
    const tty = terminal(variant === 'decline' ? 'no' : 'yes');
    await assert.rejects(
      enrollAccount({
        terminal: tty,
        readSample: async () => {
          reads++;
          if (variant === 'throws') throw Error('SECRET');
          const value = sample(
            variant === 'changed' && reads === 2
              ? 'OTHER'
              : 'EXAMPLE-account-A',
          );
          if (variant === 'missing') delete value.account.account.email;
          return value;
        },
        save: async () => saves++,
      }),
      (error) => !error.message.includes('SECRET'),
    );
    assert.equal(saves, 0);
  }
});
test('terminal labels are escaped and store failures use fixed diagnostics', async () => {
  const tty = terminal();
  await assert.rejects(
    enrollAccount({
      terminal: tty,
      readSample: async () => {
        const s = sample();
        s.account.account.email = 'label\u001b[31m\n\u009b\u202e';
        return s;
      },
      save: async () => {
        throw Error('SECRET');
      },
    }),
    /ENROLLMENT_FAILED/,
  );
  assert.doesNotMatch(tty.prompts[0], /[\u001b\u009b\u202e]/);
  assert.match(tty.prompts[0], /\\u001b/);
});

test('legacy queue behavior is preserved with managed mode absent or false', async (t) => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
  const { runQueue } = require('../codex/runtime/queue-controller.cjs');
  const { createQueueTools } = require('../codex/runtime/queue-server.cjs');
  for (const mode of [undefined, false]) {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'lonic-managed-compat-'),
    );
    t.after(() => {
      assert.equal(
        path.dirname(fs.realpathSync(root)),
        fs.realpathSync(os.tmpdir()),
      );
      assert.ok(path.basename(root).startsWith('lonic-managed-compat-'));
      fs.rmSync(root, { recursive: true, force: true });
    });
    const project = path.join(root, 'project');
    fs.mkdirSync(project);
    let sessions = 0;
    const options = {
      codex: 'EXAMPLE-no-native',
      model: selection.model,
      project,
      queue: 'EXAMPLE-task',
      authority: 'EXAMPLE-local-only',
      entrySkill: 'powerup',
      itemId: 'EXAMPLE-fixed',
      exclusions: [],
      absolute: 60,
      runRoot: path.join(root, 'runs'),
      handoffDelayMs: 0,
    };
    if (mode !== undefined) options.managed = mode;
    const readUsage = async () => {
      const value = sample();
      value.usage.rateLimits.primary.resetsAt =
        Math.floor(Date.now() / 1000) + 3600;
      value.usage.rateLimits.secondary.resetsAt =
        Math.floor(Date.now() / 1000) + 604800;
      return { response: value.usage, observedAt: Date.now() };
    };
    const result = await runQueue(options, {
      readUsage,
      runSession: async (d) => {
        sessions++;
        await createQueueTools(d, readUsage).handoff({
          status: 'done',
          reason: 'EXAMPLE done',
          itemId: d.itemId,
          resumePrompt: '$powerup EXAMPLE final report',
          sourceState: [],
          completedChecks: ['EXAMPLE passed'],
          openFindings: [],
          blockedItems: [],
          nextActions: ['EXAMPLE report'],
        });
        return { turnStatus: 'completed' };
      },
    });
    assert.equal(result.status, 'complete');
    assert.equal(sessions, 1);
  }
});
