'use strict';
const disabledContext = Object.fromEntries(
  require('../codex/runtime/managed-instruction-config.cjs').BUILTIN_CONTEXT_KEYS.map(
    (k) => [k, false],
  ),
);

const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const {
  createInventory,
  normalizeHooks,
  configDigest: nativeConfigDigest,
} = require('../codex/runtime/managed-inventory.cjs');
const config = () => ({
  config: {
    projects: { [trustProject.toLowerCase()]: { trust_level: 'trusted' } },
    ...disabledContext,
    features: { plugins: false, hooks: false, apps: false },
  },
  origins: {},
  layers: [{ name: { type: 'sessionFlags' }, config: {}, version: '1' }],
});
test('native inventory rejects warnings, unknown sources/trust and every enabled hook', () => {
  const cwd = path.resolve('EXAMPLE'),
    empty = { data: [{ cwd, errors: [], warnings: [], hooks: [] }] };
  assert.equal(normalizeHooks(empty, cwd, 'cwd').complete, true);
  for (const mutate of [
    (v) => {
      v.data[0].warnings.push('unknown');
    },
    (v) => {
      delete v.data[0].errors;
    },
    (v) => {
      v.data[0].hooks.push({ enabled: true });
    },
    (v) => {
      v.data.push(v.data[0]);
    },
  ]) {
    const value = structuredClone(empty);
    mutate(value);
    assert.throws(
      () => normalizeHooks(value, cwd, 'cwd'),
      /INVENTORY_UNCERTAIN/,
    );
  }
  for (const value of [
    { ...config(), layers: null },
    {
      config: { model_providers: { openai: {} } },
      origins: {},
      layers: config().layers,
    },
    { ...config(), config: { developer_instructions: 'unaccounted' } },
    { ...config(), config: { mcp_servers: { other: { enabled: true } } } },
  ])
    assert.throws(() => configDigest(value), /INVENTORY_UNCERTAIN/);
});
test('disabled hooks still require complete known metadata and config origins must match layers', () => {
  const cwd = path.resolve('EXAMPLE'),
    hook = {
      key: 'EXAMPLE',
      enabled: false,
      source: 'project',
      eventName: 'preToolUse',
      trustStatus: 'trusted',
      handlerType: 'command',
      command: 'EXAMPLE-never-run',
      currentHash: 'EXAMPLE',
      sourcePath: path.join(cwd, 'hooks.json'),
      isManaged: false,
      displayOrder: 0,
      timeoutSec: 10,
    };
  const response = (h) => ({
    data: [{ cwd, errors: [], warnings: [], hooks: [h] }],
  });
  assert.equal(
    normalizeHooks(response(hook), cwd, 'cwd').hooks[0].enabled,
    false,
  );
  for (const field of [
    'key',
    'currentHash',
    'trustStatus',
    'command',
    'displayOrder',
  ]) {
    const value = { ...hook };
    delete value[field];
    assert.throws(
      () => normalizeHooks(response(value), cwd, 'cwd'),
      /INVENTORY_UNCERTAIN/,
    );
  }
  assert.throws(
    () =>
      configDigest({
        ...config(),
        origins: { model: { name: { type: 'unknown' }, version: '1' } },
      }),
    /INVENTORY_UNCERTAIN/,
  );
});
test(
  'cwd and loaded-thread inventories use native APIs and pin explicit root source membership',
  {
    skip:
      process.platform !== 'win32' &&
      'Windows-only managed inventory requires real Windows project paths (CFG_PROJECT_TRUSTED)',
  },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-inventory-'));
    const project = path.join(root, 'project'),
      profile = path.join(root, 'profile');
    fs.mkdirSync(project);
    fs.mkdirSync(profile);
    try {
      fs.writeFileSync(path.join(project, 'AGENTS.md'), 'EXAMPLE');
      const calls = [],
        reader = {
          async call(method, params) {
            calls.push({ method, params });
            if (method === 'config/read')
              return {
                ...config(),
                config: {
                  ...config().config,
                  projects: {
                    [project.toLowerCase()]: { trust_level: 'trusted' },
                  },
                },
              };
            return {
              data: [
                {
                  cwd: project,
                  errors: [],
                  warnings: [],
                  hooks: [],
                  skills: [],
                },
              ],
            };
          },
        };
      const inventory = createInventory({
        project,
        profile,
        baseInstructions: 'BASE',
        developerInstructions: 'DEV',
      });
      const initial = await inventory.cwd(reader);
      assert.equal(initial.instructions.sources.length, 5);
      await inventory.thread(reader, {
        cwd: project,
        thread: { id: 't' },
        instructionSources: [],
      });
      assert.ok(
        calls.some(
          (c) => c.method === 'hooks/list' && c.params.threadId === 't',
        ),
      );
      await assert.rejects(
        inventory.thread(reader, { cwd: project, thread: { id: 't' } }),
        /INVENTORY_UNCERTAIN/,
      );
      await assert.rejects(
        inventory.thread(reader, {
          cwd: project,
          thread: { id: 't' },
          instructionSources: ['unknown'],
        }),
        /INVENTORY_UNCERTAIN/,
      );
      fs.writeFileSync(path.join(profile, 'AGENTS.md'), 'NEW');
      assert.equal(inventory.normalized().sources.length, 6);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

// Pure configuration checks use a synthetic Windows path on every platform; no file is opened.
const trustProject = 'C:\\EXAMPLE';
const configDigest = (response) => nativeConfigDigest(response, trustProject);
