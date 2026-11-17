'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {projectTrusted}=require('../codex/runtime/managed-project-trust.cjs');
const {configRules}=require('../codex/runtime/managed-inventory-rules.cjs');
const {replay}=require('./fixtures/managed-config-replay.cjs');
const cwd='C:\\Example\\MixedProject',lower=cwd.toLowerCase();
const trusted=()=>({trust_level:'trusted'});
test('S33 original-case Windows project key is admitted by the actual config rule',()=>{
  const response=replay();response.config.projects={[cwd]:trusted()};
  assert.equal(projectTrusted(response.config.projects,cwd),true);
  assert.equal(configRules(response,cwd).find(r=>r.ruleId==='CFG_PROJECT_TRUSTED').passed,true);
});
test('S33 lowercase and arbitrary-case exact Windows project keys remain admitted',()=>{
  assert.equal(projectTrusted({[lower]:trusted()},cwd),true);
  assert.equal(projectTrusted({[cwd.toUpperCase()]:trusted()},cwd),true);
});
test('S33 conflicting case-only pair refuses in both insertion orders',()=>{
  for(const pair of [{[lower]:trusted(),[cwd]:{trust_level:'untrusted'}},{[cwd]:{trust_level:'untrusted'},[lower]:trusted()}])assert.equal(projectTrusted(pair,cwd),false);
});
test('S33 identical trusted case-only aliases are consistent rather than ambiguous',()=>{
  assert.equal(projectTrusted({[lower]:trusted(),[cwd]:trusted()},cwd),true);
});
test('S33 parent-only trust never admits a child, irrespective of casing',()=>{
  for(const key of ['C:\\Example','c:\\example'])assert.equal(projectTrusted({[key]:trusted()},cwd),false);
});
test('S33 case folding does not authorize path normalization aliases or invalid entries',()=>{
  for(const key of [cwd.replaceAll('\\','/'),'C:\\Example\\x\\..\\MixedProject'])assert.equal(projectTrusted({[lower]:trusted(),[key]:trusted()},cwd),false);
  assert.equal(projectTrusted({[cwd+'\\']:trusted()},cwd),false);
  for(const entry of [null,{trust_level:'unknown'},{trust_level:'trusted',other:true}])assert.equal(projectTrusted({[lower]:trusted(),[cwd]:entry},cwd),false);
});
