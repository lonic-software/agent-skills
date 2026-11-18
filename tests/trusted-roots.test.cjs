'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('installer and queue accept linked temporary, CODEX_HOME and project roots', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-linked-roots-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const linked = {};
  for (const name of ['temp', 'home', 'project']) {
    const target = path.join(root, name);
    fs.mkdirSync(target);
    linked[name] = path.join(root, name + '-link');
    fs.symlinkSync(
      target,
      linked[name],
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  }
  const run = (args) =>
    spawnSync(process.execPath, args, {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        TMPDIR: linked.temp,
        TMP: linked.temp,
        TEMP: linked.temp,
        CODEX_HOME: linked.home,
      },
      encoding: 'utf8',
    });
  const install = run([
    'bin/install-codex.cjs',
    '--skill',
    'core-preview',
    '--project',
    linked.project,
    '--apply',
  ]);
  assert.equal(install.status, 0, install.stderr);
  assert.ok(fs.existsSync(path.join(root, 'home/skills/consult/SKILL.md')));
  const child = run([
    '-e',
    `
    const { runQueue } = require('./codex/runtime/queue-controller.cjs');
    const rateLimits = { limitId: 'codex', secondary: { windowDurationMins: 10080, usedPercent: 10, resetsAt: Math.floor(Date.now()/1000) + 86400 } };
    runQueue({ codex: 'fixture', model: 'fixture', project: process.argv[1], queue: 'fixture', authority: 'fixture only', entrySkill: 'queue-run', exclusions: [], absolute: 60, maxSteps: 1, handoffDelayMs: 0 }, {
      readUsage: async () => ({ observedAt: Date.now(), response: { accountId: 'fixture', ordinaryUsageAllowed: true, rateLimits } }),
      runSession: async () => ({ turnStatus: 'failed', error: 'fixture boundary' }),
    }).then(report => console.log(report.root));
  `,
    linked.project,
  ]);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(
    path.dirname(child.stdout.trim()),
    path.join(fs.realpathSync(root), 'temp/lonic-codex-queues'),
  );
});
