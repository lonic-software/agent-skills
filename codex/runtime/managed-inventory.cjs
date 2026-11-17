'use strict';
const fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto'), {isUtf8} = require('node:buffer');
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const {refusal, configRules, hookRules, skillRules, assertRules, inspectAll} = require('./managed-inventory-rules.cjs');
const fail = (rule = 'SOURCE_FILES') => { throw refusal(rule); };
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
function entry(response, cwd) {
  if (!Array.isArray(response?.data) || response.data.length !== 1 || !samePath(response.data[0]?.cwd, cwd)) fail();
  return response.data[0];
}
function normalizeHooks(response,cwd,scope) {
  assertRules(hookRules(response,cwd)); return {complete:true,scope,errors:[],warnings:[],hooks:response.data[0].hooks.map(()=>({known:true,enabled:false}))};
}
function skills(response,cwd) { assertRules(skillRules(response,cwd)); return response.data[0].skills.map(s=>({path:s.path,enabled:s.enabled})); }
function configDigest(response, cwd) {
  assertRules(configRules(response,cwd));
  return sha(JSON.stringify(canonical({config:response.config,layers:response.layers.map(({name,config})=>({name,config}))})));
}
function sourceFile(file) {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || fs.realpathSync(file) !== path.resolve(file) || before.size > 1024 * 1024) fail();
  const bytes = fs.readFileSync(file), after = fs.lstatSync(file);
  if (!isUtf8(bytes) || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail();
  return {key: 'file:' + file, identity: file, content: bytes.toString('utf8')};
}
function createInventory({project, profile, baseInstructions, developerInstructions}) {
  let pinnedConfig, disabledSkills;
  const exists = file => { try { fs.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; fail(); } };
  function enumerate() {
    if (!pinnedConfig) fail();
    const list = [{key: 'host:base', identity: 'managed-base-v1', content: baseInstructions}, {key: 'host:developer', identity: 'managed-developer-v1', content: developerInstructions}, {key: 'host:configuration', identity: 'native-config-content', content: pinnedConfig}, {key: 'host:disabled-skills', identity: 'disabled-skills-v1', content: JSON.stringify(disabledSkills)}];
    for (const root of [profile, project]) {
      const override = path.join(root, 'AGENTS.override.md'), normal = path.join(root, 'AGENTS.md');
      if (exists(override)) list.push(sourceFile(override)); else if (exists(normal)) list.push(sourceFile(normal));
    }
    return {complete: true, sources: list};
  }
  function normalized() {
    return {complete: true, scopeKey: 'managed-explicit-root-instructions-v1', sources: enumerate().sources.map(s => ({key: s.key, identity: s.identity, sha256: sha(s.content)}))};
  }
  return Object.freeze({
    async cwd(reader) {
      const inspection = await inspectAll(reader, project); assertRules(inspection.checks);
      const c = configDigest(inspection.responses.config,project);
      const hooks = normalizeHooks(inspection.responses.hooks, project, 'cwd');
      const available = skills(inspection.responses.skills, project).map(s => s.path).sort();
      if (pinnedConfig && c !== pinnedConfig) fail('CONFIG_PIN');
      if (pinnedConfig && JSON.stringify(available) !== JSON.stringify(disabledSkills)) fail('SKILL_PIN');
      pinnedConfig ||= c; disabledSkills ||= available;
      return {hooks, instructions: normalized()};
    },
    async thread(reader, response) {
      if (!response?.thread?.id || !samePath(response.cwd, project) || !Object.hasOwn(response, 'instructionSources') || !Array.isArray(response.instructionSources) || response.instructionSources.length) fail('THREAD_SOURCES');
      // Implicit docs/skills are disabled; bounded root files are injected by
      // this host as pinned text. Any native loaded path is therefore unknown.
      const hooks = normalizeHooks(await reader.call('hooks/list', {threadId: response.thread.id}), project, 'thread');
      const loaded = skills(await reader.call('skills/list', {cwds: [project], forceReload: true}), project);
      if (loaded.some(s => s.enabled || !disabledSkills.includes(s.path))) fail('LOADED_SKILLS');
      return {hooks, instructions: normalized()};
    },
    enumerate,
    normalized,
    disabledSkills: () => [...disabledSkills],
    developerText: () => developerInstructions + enumerate().sources.filter(s => s.key.startsWith('file:')).map(s => '\n\nPinned instructions from ' + s.identity + ':\n' + s.content).join('')
  });
}
module.exports = {createInventory, normalizeHooks, configDigest};
