'use strict';
const disabledContext=Object.fromEntries(require('../codex/runtime/managed-instruction-config.cjs').BUILTIN_CONTEXT_KEYS.map(k=>[k,false]));

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EMPTY_KEYS}=require('../codex/runtime/managed-instruction-config.cjs');
const {configRules: nativeConfigRules,assertRules}=require('../codex/runtime/managed-inventory-rules.cjs');
const {configDigest: nativeConfigDigest,createInventory}=require('../codex/runtime/managed-inventory.cjs');
function synthetic(){
  const name={type:'user',file:path.resolve('EXAMPLE-profile/config.toml')};
  const shell={inherit:'core',ignore_default_excludes:false,exclude:['EXAMPLE_SECRET_*'],set:{EXAMPLE_FLAG:'synthetic'},include_only:['EXAMPLE_SAFE']};
  const plugins=Object.fromEntries(Array.from({length:10},(_,i)=>['EXAMPLE-plugin-'+i,{enabled:true}]));
  return {config:{projects:{[trustProject.toLowerCase()]:{trust_level:"trusted"}},...disabledContext,features:{plugins:false,hooks:false,apps:false},plugins,hooks:{EXAMPLE:[]},shell_environment_policy:shell,instructions:null,developer_instructions:null,compact_prompt:null,environments:{},mcp_servers:{node_repl:{enabled:false}}},
    layers:[{name,version:'EXAMPLE',config:{shell_environment_policy:structuredClone(shell),plugins:structuredClone(plugins)}}],origins:{shell_environment_policy:{name,version:'EXAMPLE'}}};
}
test('S23 synthetic Desktop-like shape accepts pinned shell policy and ten inert plugin registrations',()=>{
  const c=synthetic();assertRules(configRules(c));assert.match(configDigest(c),/^[a-f0-9]{64}$/);
});
test('S23 every explicit instruction or prompt loader must be empty',()=>{
  assert.deepEqual(EMPTY_KEYS,['instructions','developer_instructions','compact_prompt','experimental_compact_prompt_file','model_instructions_file','experimental_realtime_ws_backend_prompt','experimental_realtime_start_instructions']);
  for(const key of EMPTY_KEYS){for(const value of ['EXAMPLE text',false,{},[]]){const c=synthetic();c.config[key]=value;assert.throws(()=>assertRules(configRules(c)),e=>e.ruleId==='CFG_INSTRUCTIONS');}
    for(const value of [null,'']){const c=synthetic();c.config[key]=value;assertRules(configRules(c));}}
});
test('S23 unknown instruction-like keys refuse even empty; environments retain their own rule',()=>{
  for(const key of ['new_prompt_file','additional_instructions','future_environment','Shell_environment_policy'])for(const value of [null,'','EXAMPLE']){const c=synthetic();c.config[key]=value;assert.throws(()=>assertRules(configRules(c)),e=>e.ruleId==='CFG_INSTRUCTIONS');}
  const c=synthetic();c.config.environments={EXAMPLE:{}};const rows=configRules(c);assert.equal(rows.find(r=>r.ruleId==='CFG_INSTRUCTIONS').passed,true);assert.throws(()=>assertRules(rows),e=>e.ruleId==='CFG_ENVIRONMENTS');
});
test('S23 effective and layer shell policy content are hashed, independent of key order',()=>{
  const c=synthetic(),initial=configDigest(c),reordered=structuredClone(c);reordered.config.shell_environment_policy=Object.fromEntries(Object.entries(c.config.shell_environment_policy).reverse());assert.equal(configDigest(reordered),initial);
  for(const target of ['effective','layer']){const next=structuredClone(c);(target==='effective'?next.config:next.layers[0].config).shell_environment_policy.set.EXAMPLE_FLAG='changed';assert.notEqual(configDigest(next),initial);}
});
test('S23 shell policy drift refuses inventory revalidation with CONFIG_PIN',{skip: process.platform !== 'win32' && 'Windows-only managed inventory requires real Windows project paths (CFG_PROJECT_TRUSTED)'}, async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lonic-s23-'));try{
    const project=path.join(root,'project'),profile=path.join(root,'profile');fs.mkdirSync(project);fs.mkdirSync(profile);
    let response=synthetic();response.config.projects={[project.toLowerCase()]:{trust_level:"trusted"}};const reader={async call(m){return m==='config/read'?response:{data:[{cwd:project,errors:[],warnings:[],hooks:[],skills:[]}]};}};
    const inv=createInventory({project,profile,baseInstructions:'EXAMPLE',developerInstructions:'EXAMPLE'});await inv.cwd(reader);
    response=structuredClone(response);response.config.shell_environment_policy.set.EXAMPLE_FLAG='changed';await assert.rejects(inv.cwd(reader),e=>e.ruleId==='CONFIG_PIN');
  }finally{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true});}
});

// Pure configuration checks use a synthetic Windows path on every platform; no file is opened.
const trustProject='C:\\EXAMPLE';
const configRules=response=>nativeConfigRules(response,trustProject);
const configDigest=response=>nativeConfigDigest(response,trustProject);
