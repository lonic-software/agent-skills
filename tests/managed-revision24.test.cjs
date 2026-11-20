'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  replay: nativeReplay,
  fixture,
  observedScopes,
} = require('./fixtures/managed-config-replay.cjs');
const {
  configRules: nativeConfigRules,
  assertRules,
} = require('../codex/runtime/managed-inventory-rules.cjs');
const {
  configDigest: nativeConfigDigest,
} = require('../codex/runtime/managed-inventory.cjs');
const {
  BUILTIN_CONTEXT_KEYS,
  emptyInstructionSources,
} = require('../codex/runtime/managed-instruction-config.cjs');
const {
  managedIsolationSettings,
} = require('../codex/runtime/managed-launch-settings.cjs');
const type = (v) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
test('S24 full N0b observed root, feature and layer key/type replay passes every CFG rule', () => {
  const r = replay();
  assert.equal(Object.keys(r.config).length, 106);
  assert.equal(Object.keys(r.config.features).length, 19);
  assert.equal(r.layers.length, 4);
  for (const s of observedScopes(r)) {
    const expected = fixture.scopes.find((x) => x.scope === s.scope);
    assert.ok(expected);
    assert.deepEqual(
      Object.keys(s.value || {}).sort(),
      expected.keys.map((k) => k.name).sort(),
    );
    for (const k of expected.keys)
      assert.equal(type(s.value[k.name]), k.type, k.name);
  }
  const checks = configRules(r);
  assert.ok(checks.length >= 12);
  assertRules(checks);
  assert.ok(checks.every((c) => c.ruleId.startsWith('CFG_') && c.passed));
});
test('S24 five named Boolean context switches are explicitly disabled on every managed launch', () => {
  assert.deepEqual(BUILTIN_CONTEXT_KEYS, [
    'include_collaboration_mode_instructions',
    'include_environment_context',
    'include_permissions_instructions',
    'include_apps_instructions',
    'include_environment_context_time',
  ]);
  for (const key of BUILTIN_CONTEXT_KEYS) {
    assert.equal(managedIsolationSettings()[key], false);
    for (const value of [true, null, undefined, 'false']) {
      const r = replay();
      if (value === undefined) delete r.config[key];
      else r.config[key] = value;
      assert.equal(
        configRules(r).find((c) => c.ruleId === 'CFG_BUILTIN_CONTEXT_DISABLED')
          .passed,
        false,
        key,
      );
    }
  }
});
test('S24 unknown names and unresolved hash labels refuse at root, features and layer scopes', () => {
  for (const key of ['unreviewed_setting', 'key-sha256:' + '0'.repeat(64)])
    for (const target of ['root', 'features', 'layer', 'layer-features']) {
      const r = replay(),
        c =
          target === 'root'
            ? r.config
            : target === 'features'
              ? r.config.features
              : target === 'layer'
                ? r.layers[0].config
                : r.layers[0].config.features;
      c[key] = null;
      assert.equal(
        configRules(r).find((c) => c.ruleId === 'CFG_KEYS').passed,
        false,
        target,
      );
    }
});
test('S24 context flags are typed separately from text loaders and all layer contents remain pinned', () => {
  const r = replay();
  assert.equal(emptyInstructionSources(r.config), true);
  for (const key of BUILTIN_CONTEXT_KEYS) {
    const c = { ...r.config, [key]: true };
    assert.equal(emptyInstructionSources(c), true);
    assert.equal(emptyInstructionSources({ ...c, [key]: {} }), false);
  }
  const before = configDigest(r);
  r.layers[0].config[BUILTIN_CONTEXT_KEYS[0]] = true;
  assertRules(configRules(r));
  assert.notEqual(configDigest(r), before);
  // Effective disablement is mandatory; lower-layer preferences may be overridden.
});
test('S24 newly resolved realtime text-loader names remain empty-only', () => {
  for (const key of [
    'experimental_realtime_ws_backend_prompt',
    'experimental_realtime_start_instructions',
  ]) {
    const r = replay();
    assert.equal(r.config[key], null);
    r.config[key] = 'EXAMPLE forbidden text';
    assert.equal(
      configRules(r).find((c) => c.ruleId === 'CFG_INSTRUCTIONS').passed,
      false,
    );
  }
});

// Pure configuration checks use a synthetic Windows path on every platform; no file is opened.
const trustProject = 'C:\\EXAMPLE';
const configRules = (response) => nativeConfigRules(response, trustProject);
const configDigest = (response) => nativeConfigDigest(response, trustProject);

// Preserve the observed key/type shape; only the synthetic trust value is Windows-shaped.
function replay() {
  const response = nativeReplay();
  response.config.projects = {
    [trustProject.toLowerCase()]: { trust_level: 'trusted' },
  };
  return response;
}
