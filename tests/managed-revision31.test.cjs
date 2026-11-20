'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { hostFixture } = require('./fixtures/managed-host-fixture.cjs');
const { createManagedHost } = require('../codex/runtime/managed-host.cjs');
const { enrollAccount } = require('../codex/runtime/managed-admission.cjs');
test(
  'S31 an injected observer supplements the real method-only notification log',
  { skip: process.platform !== 'win32' },
  () =>
    hostFixture(async (f) => {
      const events = [],
        host = createManagedHost(f.cfg, { audit: (e) => events.push(e) });
      host.host.audit({
        event: 'native-notification',
        method: 'EXAMPLE/progress',
        params: { secret: 'PRIVATE' },
      });
      const file = path.join(
          path.dirname(host.enrollmentPath),
          'notifications.jsonl',
        ),
        rows = fs.readFileSync(file, 'utf8');
      assert.deepEqual(JSON.parse(rows), {
        event: 'native-notification',
        method: 'EXAMPLE/progress',
      });
      assert.doesNotMatch(rows, /PRIVATE|secret|params/);
      assert.equal(events.at(-1).method, 'EXAMPLE/progress');
      await host.dispose();
    }),
);
test(
  'S31 a failing injected observer cannot erase the local notification record',
  { skip: process.platform !== 'win32' },
  () =>
    hostFixture(async (f) => {
      const host = createManagedHost(f.cfg, {
        audit: (e) => {
          if (e.event === 'native-notification') throw Error('EXAMPLE');
        },
      });
      assert.throws(() =>
        host.host.audit({
          event: 'native-notification',
          method: 'EXAMPLE/notice',
        }),
      );
      assert.equal(
        JSON.parse(
          fs.readFileSync(
            path.join(path.dirname(host.enrollmentPath), 'notifications.jsonl'),
            'utf8',
          ),
        ).method,
        'EXAMPLE/notice',
      );
      await host.dispose();
    }),
);
test('S30 enrollment question promises only the supported recognizable email, never workspace fields', async () => {
  const account = {
      account: {
        type: 'chatgpt',
        email: 'example@example.invalid',
        workspaceName: 'PRIVATE-workspace',
      },
      workspaceRouting: {
        chatgptAccountId: 'PRIVATE-ID',
        backendOrigin: 'PRIVATE-origin',
      },
    },
    usage = { accountId: 'PRIVATE-ID' };
  let prompt, saved;
  await enrollAccount({
    terminal: {
      inputTTY: true,
      outputTTY: true,
      confirm: async (text) => {
        prompt = text;
        return 'yes';
      },
    },
    readSample: async () => ({ account, usage }),
    save: (v) => {
      saved = v;
    },
  });
  assert.equal(
    prompt,
    'Approve account "example@example.invalid"? Type yes to store only its fingerprint: ',
  );
  assert.doesNotMatch(prompt, /workspace|Workspace|PRIVATE/);
  assert.deepEqual(Object.keys(saved).sort(), [
    'algorithm',
    'fingerprint',
    'schema',
  ]);
});
