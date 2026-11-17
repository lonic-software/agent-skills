'use strict';
const path = require('node:path');
const {projectTrusted} = require('./managed-project-trust.cjs');
const {emptyInstructionSources,builtinContextDisabled} = require('./managed-instruction-config.cjs');
const {verifiedConfigNames} = require('./managed-config-key-policy.cjs');
const issued = new WeakSet();
const RULES = Object.freeze(['CFG_SHAPE','CFG_LAYERS','CFG_ORIGINS','CFG_INSTRUCTIONS','CFG_KEYS','CFG_BUILTIN_CONTEXT_DISABLED','CFG_OPENAI_PROVIDER','CFG_PLUGINS_DISABLED','CFG_HOOKS_DISABLED','CFG_APPS_DISABLED','CFG_ENVIRONMENTS','CFG_MCP_DISABLED','CFG_PROJECT_TRUSTED','HOOK_COVERAGE','HOOK_DIAGNOSTICS','HOOK_DISABLED','HOOK_METADATA','SKILL_COVERAGE','SKILL_METADATA','READ_CONFIG','READ_HOOKS','READ_SKILLS','INPUTS_PIN','SOURCE_FILES','THREAD_SOURCES','CONFIG_PIN','SKILL_PIN','LOADED_SKILLS']);
function refusal(ruleId) {
  if (!RULES.includes(ruleId)) throw Error('MANAGED_RULE_INVALID');
  const e = Object.assign(Error('MANAGED_INVENTORY_UNCERTAIN:' + ruleId), {code: 'MANAGED_ADMISSION_REFUSED', ruleId}); issued.add(e); return e;
}
const isRefusal = error => issued.has(error);
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const samePath = (a,b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const canonical = v => Array.isArray(v) ? v.map(canonical) : record(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,canonical(v[k])])) : v;
const result = (ruleId, predicate) => { try { return {ruleId, passed: predicate() === true}; } catch { return {ruleId, passed: false}; } };
function configRules(response, cwd) {
  const c = response?.config;
  return [
    result('CFG_SHAPE', () => record(c) && record(response.origins) && Array.isArray(response.layers) && response.layers.length > 0),
    result('CFG_LAYERS', () => response.layers.length > 0 && response.layers.every(l => ['packagedDefaults','system','user','project','sessionFlags'].includes(l?.name?.type) && typeof l.version === 'string' && !l.disabledReason && record(l.config) && (!['packagedDefaults','system','user'].includes(l.name.type) || typeof l.name.file === 'string' && path.isAbsolute(l.name.file)) && (l.name.type !== 'project' || typeof l.name.dotCodexFolder === 'string' && path.isAbsolute(l.name.dotCodexFolder)))),
    result('CFG_ORIGINS', () => record(response.origins) && Object.values(response.origins).every(o => typeof o?.version === 'string' && response.layers.some(l => JSON.stringify(canonical(l.name)) === JSON.stringify(canonical(o.name))))),
    result('CFG_INSTRUCTIONS', () => emptyInstructionSources(c)),
    result('CFG_KEYS', () => verifiedConfigNames(response)),
    result('CFG_BUILTIN_CONTEXT_DISABLED', () => builtinContextDisabled(c)),
    result('CFG_OPENAI_PROVIDER', () => record(c) && !c.model_providers?.openai),
    result('CFG_PLUGINS_DISABLED', () => record(c) && c.features?.plugins === false && (c.plugins == null || record(c.plugins))),
    result('CFG_HOOKS_DISABLED', () => record(c) && c.features?.hooks === false),
    result('CFG_APPS_DISABLED', () => record(c) && c.features?.apps === false),
    result('CFG_ENVIRONMENTS', () => record(c) && (c.environments == null || record(c.environments) && Object.keys(c.environments).length === 0)),
    result('CFG_PROJECT_TRUSTED', () => projectTrusted(c?.projects, cwd)),
    result('CFG_MCP_DISABLED', () => record(c) && (c.mcp_servers == null || record(c.mcp_servers) && Object.values(c.mcp_servers).every(s => s?.enabled === false)))
  ];
}
function hookRules(response, cwd) {
  const e = response?.data?.[0], hooks = e?.hooks;
  return [
    result('HOOK_COVERAGE', () => Array.isArray(response?.data) && response.data.length === 1 && samePath(e.cwd,cwd)),
    result('HOOK_DIAGNOSTICS', () => Array.isArray(e.errors) && !e.errors.length && Array.isArray(e.warnings) && !e.warnings.length && Array.isArray(hooks)),
    result('HOOK_DISABLED', () => Array.isArray(hooks) && hooks.every(h => h?.enabled === false)),
    result('HOOK_METADATA', () => Array.isArray(hooks) && new Set(hooks.map(h => h.key)).size === hooks.length && hooks.every(h =>
      ['system','user','project','mdm','sessionFlags','plugin','cloudRequirements','cloudManagedConfig','legacyManagedConfigFile','legacyManagedConfigMdm'].includes(h.source) &&
      ['preModelRequest','postModelRequest','preToolUse','permissionRequest','postToolUse','preCompact','postCompact','sessionStart','sessionEnd','userPromptSubmit','subagentStart','subagentStop','stop','interrupt'].includes(h.eventName) &&
      ['trusted','managed'].includes(h.trustStatus) && ['command','mcpTool','prompt','agent'].includes(h.handlerType) && typeof h.currentHash === 'string' && !!h.currentHash && typeof h.sourcePath === 'string' && path.isAbsolute(h.sourcePath) &&
      typeof h.key === 'string' && !!h.key && typeof h.isManaged === 'boolean' && Number.isSafeInteger(h.displayOrder) && Number.isSafeInteger(h.timeoutSec) && h.timeoutSec >= 0 &&
      (h.handlerType !== 'command' || typeof h.command === 'string') && (h.handlerType !== 'mcpTool' || typeof h.server === 'string' && typeof h.tool === 'string')))
  ];
}
function skillRules(response,cwd) {
  const e=response?.data?.[0];
  return [result('SKILL_COVERAGE',()=>Array.isArray(response?.data)&&response.data.length===1&&samePath(e.cwd,cwd)&&Array.isArray(e.errors)&&!e.errors.length&&Array.isArray(e.skills)),
    result('SKILL_METADATA',()=>Array.isArray(e.skills)&&new Set(e.skills.map(s=>s.path)).size===e.skills.length&&e.skills.every(s=>typeof s.path==='string'&&path.isAbsolute(s.path)&&typeof s.enabled==='boolean'&&typeof s.name==='string'&&typeof s.description==='string'&&['user','repo','system','admin'].includes(s.scope)))];
}
function assertRules(checks) { const first=checks.find(c=>!c.passed); if(first)throw refusal(first.ruleId); }
async function inspectAll(reader,cwd,{threadId}={}) {
  const checks=[],responses={};
  for(const [key,method,params,ruleId] of [['config','config/read',{cwd,includeLayers:true},'READ_CONFIG'],['hooks','hooks/list',threadId?{threadId}:{cwds:[cwd]},'READ_HOOKS'],['skills','skills/list',{cwds:[cwd],forceReload:true},'READ_SKILLS']]) {
    try { responses[key]=await reader.call(method,params);checks.push({ruleId,passed:true}); } catch { checks.push({ruleId,passed:false}); }
  }
  checks.push(...configRules(responses.config,cwd),...hookRules(responses.hooks,cwd),...skillRules(responses.skills,cwd));
  return {checks, responses, passed:checks.every(c=>c.passed)}; // Responses stay private; persist checks only.
}
module.exports={RULES,refusal,isRefusal,configRules,hookRules,skillRules,assertRules,inspectAll};
