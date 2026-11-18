'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto');
const { savePlan, transact } = require('../bin/manage-codex.cjs');
const { runQueue } = require('../codex/runtime/queue-controller.cjs');
const { createQueueTools } = require('../codex/runtime/queue-server.cjs');
const {
  inspectUsage,
  createBudget,
} = require('../codex/runtime/queue-budget.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-review-'));
  t.after(() => {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('lonic-review-'));
    assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function updater(t) {
  const root = fixture(t),
    repo = path.join(root, 'repo'),
    project = path.join(root, 'project'),
    dir = path.join(repo, 'codex/skills/example');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(project);
  fs.writeFileSync(
    path.join(repo, 'codex/manifest.json'),
    JSON.stringify({
      schema: 1,
      selections: { example: { skills: ['example'], agents: [] } },
      blocked: {},
    }),
  );
  for (const name of ['SKILL.md', 'z.txt']) {
    fs.writeFileSync(path.join(dir, name), 'ORIGINAL ' + name);
  }
  const installer = require('../bin/install-codex.cjs');
  installer.apply(installer.plan(repo, project, 'example'));
  for (const name of ['SKILL.md', 'z.txt'])
    fs.writeFileSync(path.join(dir, name), 'NEW ' + name);
  const file = path.join(root, 'plan.json'),
    plan = savePlan(repo, project, 'example', file);
  return {
    root,
    project,
    file,
    plan,
    receipt: file + '.applied.json',
    lock: path.join(project, '.codex/lonic/update.lock'),
  };
}
function corruptRename(t, onNumber, mutate) {
  const original = fs.renameSync;
  let calls = 0;
  fs.renameSync = (from, to) => {
    original(from, to);
    if (++calls === onNumber) mutate(to);
  };
  t.after(() => {
    fs.renameSync = original;
  });
}
test('apply readback failure reports the mutated file and preserves concurrent bytes', (t) => {
  const s = updater(t);
  corruptRename(t, 2, (file) => fs.appendFileSync(file, ' EXTERNAL'));
  assert.throws(
    () => transact(s.file, s.plan.sha256),
    /Update readback failed/,
  );
  const receipt = JSON.parse(fs.readFileSync(s.receipt));
  assert.equal(receipt.status, 'needs-reconciliation');
  assert.deepEqual(receipt.retained, [s.plan.files[1].path]);
  assert.equal(
    fs.readFileSync(path.join(s.project, s.plan.files[0].path), 'utf8'),
    'ORIGINAL SKILL.md',
  );
  assert.equal(
    fs.readFileSync(path.join(s.project, s.plan.files[1].path), 'utf8'),
    'NEW z.txt EXTERNAL',
  );
});
for (const failAt of [1, 2])
  test(
    'rollback readback failure on file ' + failAt + ' records reconciliation',
    (t) => {
      const s = updater(t);
      transact(s.file, s.plan.sha256);
      corruptRename(t, failAt, (file) => fs.appendFileSync(file, ' EXTERNAL'));
      assert.throws(
        () => transact(s.file, s.plan.sha256, { rollback: true }),
        /Update readback failed/,
      );
      const receipt = JSON.parse(fs.readFileSync(s.receipt)),
        affected = s.plan.files.at(-failAt).path;
      assert.equal(receipt.status, 'needs-reconciliation');
      assert.deepEqual(receipt.retained, [affected]);
      assert.match(
        fs.readFileSync(path.join(s.project, affected), 'utf8'),
        /^ORIGINAL .* EXTERNAL$/,
      );
      for (const item of s.plan.files.filter((f) => f.path !== affected))
        assert.match(
          fs.readFileSync(path.join(s.project, item.path), 'utf8'),
          /^NEW /,
        );
    },
  );
test('rollback preflight failure preserves its applied receipt and user edit', (t) => {
  const s = updater(t);
  transact(s.file, s.plan.sha256);
  const receipt = fs.readFileSync(s.receipt),
    file = path.join(s.project, s.plan.files[0].path);
  fs.writeFileSync(file, 'EXTERNAL');
  assert.throws(
    () => transact(s.file, s.plan.sha256, { rollback: true }),
    /changed since/,
  );
  assert.deepEqual(fs.readFileSync(s.receipt), receipt);
  assert.equal(fs.readFileSync(file, 'utf8'), 'EXTERNAL');
});
test('missing update lock does not mask a readback error', (t) => {
  const s = updater(t);
  corruptRename(t, 1, (file) => {
    fs.unlinkSync(s.lock);
    fs.appendFileSync(file, ' EXTERNAL');
  });
  assert.throws(
    () => transact(s.file, s.plan.sha256),
    /Update readback failed/,
  );
  assert.equal(
    JSON.parse(fs.readFileSync(s.receipt)).status,
    'needs-reconciliation',
  );
});
test('missing update lock does not turn a completed update into failure', (t) => {
  const s = updater(t);
  corruptRename(t, 1, () => fs.unlinkSync(s.lock));
  assert.equal(transact(s.file, s.plan.sha256).status, 'applied');
  assert.equal(JSON.parse(fs.readFileSync(s.receipt)).status, 'applied');
});
test('stale updater lock blocks mutation and retains its digest', (t) => {
  const s = updater(t);
  fs.mkdirSync(path.dirname(s.lock), { recursive: true });
  fs.writeFileSync(s.lock, 'EXAMPLE-old-digest');
  assert.throws(() => transact(s.file, s.plan.sha256), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(s.lock, 'utf8'), 'EXAMPLE-old-digest');
  assert.equal(fs.existsSync(s.receipt), false);
  for (const item of s.plan.files)
    assert.match(
      fs.readFileSync(path.join(s.project, item.path), 'utf8'),
      /^ORIGINAL /,
    );
});
function usage() {
  const now = Date.now();
  return {
    observedAt: now,
    response: {
      accountId: 'EXAMPLE',
      ordinaryUsageAllowed: true,
      rateLimits: {
        limitId: 'codex',
        secondary: {
          windowDurationMins: 10080,
          usedPercent: 25,
          resetsAt: Math.floor(now / 1000) + 86400,
        },
      },
    },
  };
}
function queue(t) {
  const root = fixture(t),
    project = path.join(root, 'project');
  fs.mkdirSync(project);
  return {
    root,
    options: {
      project,
      codex: 'EXAMPLE-not-launched',
      model: 'EXAMPLE',
      queue: 'EXAMPLE',
      authority: 'EXAMPLE fixture only',
      entrySkill: 'queue-run',
      exclusions: [],
      absolute: 60,
      runRoot: path.join(root, 'runs'),
      maxSteps: 1,
      handoffDelayMs: 0,
    },
  };
}
test('controller stops on an invalid budget without overwriting the invalid receipt', async (t) => {
  const s = queue(t);
  let reads = 0,
    budgetFile;
  const invalid = '{"schema":999,"EXAMPLE":"retain for diagnosis"}\n';
  const result = await runQueue(s.options, {
    readUsage: async () => {
      if (++reads === 2) {
        const run = fs
          .readdirSync(s.options.runRoot)
          .find((n) => n.startsWith('run-'));
        budgetFile = path.join(s.options.runRoot, run, 'budget.json');
        fs.writeFileSync(budgetFile, invalid);
      }
      return usage();
    },
    runSession: async () => {
      assert.fail('An invalid budget must never start a session');
    },
  });
  assert.equal(result.reason, 'invalid-run-budget');
  assert.equal(result.sessions.length, 0);
  assert.equal(fs.readFileSync(budgetFile, 'utf8'), invalid);
});
function queueTools(t) {
  const root = fixture(t),
    u = usage(),
    budget = createBudget(
      inspectUsage(u.response, { observedAt: u.observedAt }),
      { runId: 'EXAMPLE', absolute: 60 },
    ),
    budgetFile = path.join(root, 'budget.json');
  fs.writeFileSync(budgetFile, JSON.stringify(budget) + '\n');
  return {
    root,
    budgetFile,
    tools: createQueueTools({ budgetFile }, async () => usage()),
  };
}
test('queue context retains an invalid budget receipt while refusing work', async (t) => {
  const s = queueTools(t),
    invalid = '{"schema":999}\n';
  fs.writeFileSync(s.budgetFile, invalid);
  const result = await s.tools.context();
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'invalid-run-budget');
  assert.equal(fs.readFileSync(s.budgetFile, 'utf8'), invalid);
});
test('stale fixed budget temp file cannot block later saves or be deleted', async (t) => {
  const s = queueTools(t);
  fs.writeFileSync(s.budgetFile + '.tmp', 'EXAMPLE-crash-evidence');
  assert.equal((await s.tools.context()).allowed, true);
  assert.equal((await s.tools.context()).allowed, true);
  assert.equal(
    fs.readFileSync(s.budgetFile + '.tmp', 'utf8'),
    'EXAMPLE-crash-evidence',
  );
  assert.equal(JSON.parse(fs.readFileSync(s.budgetFile)).lastPercent, 25);
  assert.deepEqual(fs.readdirSync(s.root).sort(), [
    'budget.json',
    'budget.json.tmp',
  ]);
});
test('failed budget rename preserves the old receipt and removes its own temp file', async (t) => {
  const s = queueTools(t),
    before = fs.readFileSync(s.budgetFile),
    rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === s.budgetFile)
      throw Object.assign(Error('EXAMPLE rename failure'), { code: 'EIO' });
    return rename(from, to);
  };
  t.after(() => {
    fs.renameSync = rename;
  });
  await assert.rejects(s.tools.context(), /EXAMPLE rename failure/);
  assert.deepEqual(fs.readFileSync(s.budgetFile), before);
  assert.deepEqual(fs.readdirSync(s.root), ['budget.json']);
});
test('stale queue lock retains owner metadata and blocks session startup', async (t) => {
  const s = queue(t),
    project = fs.realpathSync(s.options.project),
    key = process.platform === 'win32' ? project.toLowerCase() : project,
    lock = path.join(
      os.tmpdir(),
      'lonic-codex-queue-locks',
      crypto.createHash('sha256').update(key).digest('hex') + '.lock',
    );
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const owner = JSON.stringify({
    runId: 'EXAMPLE-stale',
    pid: 99999999,
    project: s.options.project,
  });
  fs.writeFileSync(lock, owner, { flag: 'wx' });
  t.after(() => fs.unlinkSync(lock));
  await assert.rejects(
    runQueue(s.options, {
      readUsage: async () => usage(),
      runSession: async () => assert.fail('Must not start'),
    }),
    { code: 'EEXIST' },
  );
  assert.equal(fs.readFileSync(lock, 'utf8'), owner);
});
