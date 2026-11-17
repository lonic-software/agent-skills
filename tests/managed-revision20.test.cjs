'use strict';
const disabledContext=Object.fromEntries(require('../codex/runtime/managed-instruction-config.cjs').BUILTIN_CONTEXT_KEYS.map(k=>[k,false]));

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {configRules: nativeConfigRules,hookRules,inspectAll,assertRules}=require('../codex/runtime/managed-inventory-rules.cjs');
const {managedIsolationSettings}=require('../codex/runtime/managed-launch-settings.cjs');
const {createManagedProcess}=require('../codex/runtime/managed-process.cjs');
const {createIntentJournal,projectState,readJSON}=require('../codex/runtime/managed-storage.cjs');
const {reconcileManaged}=require('../codex/runtime/managed-reconcile.cjs');
const cfg=()=>({config:{projects:{[trustProject.toLowerCase()]:{trust_level:"trusted"}},...disabledContext,features:{plugins:false,hooks:false,apps:false},plugins:{EXAMPLE:{enabled:true}},mcp_servers:{node_repl:{enabled:false}}},origins:{},layers:[{name:{type:'sessionFlags'},version:'EXAMPLE',config:{}}]});
test('S20 plugin entries are admitted only with explicit effective disablement',()=>{
  assertRules(configRules(cfg()));
  for(const value of [undefined,true,'false']){const c=cfg();c.config.features.plugins=value;assert.throws(()=>assertRules(configRules(c)),e=>e.code==='MANAGED_ADMISSION_REFUSED'&&e.ruleId==='CFG_PLUGINS_DISABLED');}
  for(const name of ['hooks','apps']){const c=cfg();delete c.config.features[name];assert.ok(configRules(c).some(r=>!r.passed));}
  const c=cfg();c.config.mcp_servers.node_repl.enabled=true;assert.throws(()=>assertRules(configRules(c)),/CFG_MCP_DISABLED/);
});
test('S20/S21 diagnostic collector executes every read and records only rule IDs and pass/fail',async()=>{
  const calls=[],cwd=path.resolve('EXAMPLE');
  const result=await inspectAll({async call(method){calls.push(method);if(method==='config/read')return {config:{plugins:{PRIVATE:true}}};return {data:[{cwd,errors:[],warnings:[],hooks:[{enabled:true,command:'PRIVATE'}],skills:[]}]};}},cwd);
  assert.deepEqual(calls,['config/read','hooks/list','skills/list']);assert.equal(result.passed,false);assert.ok(result.checks.some(r=>r.ruleId==='HOOK_DISABLED'&&!r.passed));assert.doesNotMatch(JSON.stringify(result.checks),/PRIVATE|command/);
  assert.ok(result.checks.every(r=>Object.keys(r).sort().join(',')==='passed,ruleId'));
});
test('diagnostic collector continues other reads after one RPC failure without retry',async()=>{
  const calls=[],cwd=path.resolve('EXAMPLE');await inspectAll({async call(m){calls.push(m);if(m==='config/read')throw Error('PRIVATE');return {data:[{cwd,errors:[],warnings:[],hooks:[],skills:[]}]};}},cwd);assert.deepEqual(calls,['config/read','hooks/list','skills/list']);
});
test('shared inventory/author isolation flags include plugin, hook, skill and MCP suppression',()=>{
  const flags=managedIsolationSettings();for(const k of ['features.plugins','features.hooks','features.apps','skills.bundled.enabled','skills.include_instructions','mcp_servers.node_repl.enabled'])assert.equal(flags[k],false);
  assert.equal(flags.project_doc_max_bytes,0);assert.equal(Object.keys(flags).some(k=>k.startsWith('model_providers.')),false);
});
async function stateFixture(action){const root=fs.mkdtempSync(path.join(os.tmpdir(),'lonic-s18-')),project=path.join(root,'project'),stateRoot=path.join(root,'state');fs.mkdirSync(project);const {dir}=projectState(stateRoot,project),journal=createIntentJournal(dir,'EXAMPLE');journal.begin({pid:42,created:'639300000000000000'});const intent={id:'EXAMPLE',generation:'EXAMPLE'};journal.register(intent);try{await action({root,project,stateRoot,dir,journal,intent,file:path.join(dir,'intent.json')});}finally{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true});}}
test('S18 actual Node ENOENT records not-created and can reconcile without PID guessing',()=>stateFixture(async f=>{
  let signals=0;
  const owner=createManagedProcess({mode:'managed',backend:{observe:async()=>assert.fail('no process to observe'),signal:async()=>{signals++;}},timeoutMs:2000,onSpawnAttempt:()=>f.journal.recordSpawnAttempt(),onNoProcess:e=>f.journal.recordNoProcess(e)});
  const result=await owner.start({registeredIntent:f.intent,spawn:()=>spawn(path.join(f.root,'missing-executable'),[],{windowsHide:true,stdio:['pipe','pipe','pipe']})});
  assert.equal(result.reason,'PROCESS_SPAWN_FAILED');assert.equal(result.recoveryRequired,false);assert.equal((await owner.close()).allowed,true);
  const record=readJSON(f.file).intents[0];assert.equal(record.spawnAttempted,true);assert.equal(record.spawnOutcome,'not-created');assert.equal(record.pidHint,undefined);assert.equal(signals,0);
  const fixed={backend:{observe:async()=>({complete:true,processes:[]})},adapter:{},gate:{acquire:async()=>({allowed:true}),check:async()=>({allowed:true}),release:async()=>({allowed:true})}};
  assert.equal((await reconcileManaged({project:f.project,stateRoot:f.stateRoot,terminal:{inputTTY:true,outputTTY:true,confirm:async()=> 'RECONCILE'}},fixed)).status,'reconciled');
}));
test('S18 failed first observation keeps created PID uncertain and never invents noncreation',()=>stateFixture(async f=>{
  let child,closed;
  const owner=createManagedProcess({mode:'managed',backend:{observe:async()=>{throw Error('EXAMPLE');},signal:async()=>assert.fail('unidentified process must not be signalled')},timeoutMs:1000,onSpawnAttempt:()=>f.journal.recordSpawnAttempt(),onSpawned:c=>f.journal.recordProcess(c),onNoProcess:()=>assert.fail('must remain uncertain')});
  const started=await owner.start({registeredIntent:f.intent,spawn:()=>{child=spawn(process.execPath,['-e','process.stdin.resume();process.stdin.on("end",()=>process.exit(0));'],{windowsHide:true,stdio:['pipe','pipe','pipe']});closed=new Promise(r=>child.once('close',r));return child;}});
  assert.equal(started.allowed,false);const cleanup=await owner.close();assert.equal(cleanup.recoveryRequired,true);await closed;
  const row=readJSON(f.file).intents[0];assert.equal(row.pidHint,child.pid);assert.equal(row.spawnOutcome,undefined);assert.equal(row.identities,undefined);
}));
for(const variant of ['later-boot','same-boot','changed-boot','cancel'])test('S18 explicit reboot reconciliation: '+variant,()=>stateFixture(async f=>{
  f.journal.recordSpawnAttempt();f.journal.recordProcess({pid:43});let reads=0;
  const dep={readBoot:async()=>{reads++;return variant==='same-boot'?'639299000000000000':variant==='changed-boot'&&reads===2?'639302000000000000':'639301000000000000';},backend:{observe:async()=>({complete:true,processes:[]})},adapter:{},gate:{acquire:async()=>({allowed:true}),check:async()=>({allowed:true}),release:async()=>({allowed:true})}};
  const config={project:f.project,stateRoot:f.stateRoot,afterReboot:true,terminal:{inputTTY:true,outputTTY:true,confirm:async()=>variant==='cancel'?'RECONCILE':'RECONCILE-AFTER-REBOOT'}};
  if(variant==='later-boot'){assert.equal((await reconcileManaged(config,dep)).status,'reconciled');assert.equal(readJSON(f.file).reconciliation.kind,'interactive-after-full-reboot');}
  else {await assert.rejects(reconcileManaged(config,dep));assert.equal(readJSON(f.file).status,'active');}
}));
test('boot reader is read-only, policy-checked and rejects invalid observations without bypass',async()=>{
  const {readWindowsBoot}=require('../codex/runtime/managed-windows-boot.cjs');let checked=false;
  assert.equal(await readWindowsBoot({checkPolicy:async()=>{checked=true;},execute:(exe,args,opts,cb)=>{assert.equal(checked,true);assert.ok(args.includes('-NoProfile'));assert.doesNotMatch(args.join(' '),/Bypass|Set-ExecutionPolicy/);cb(null,'639301000000000000');}}),'639301000000000000');
});
test('S21 original rule survives a failed cleanup; journal remains unresolved',()=>stateFixture(async f=>{
  const {ownedRead}=require('../codex/runtime/managed-owned-read.cjs'),{refusal}=require('../codex/runtime/managed-inventory-rules.cjs');
  // ownedRead registers its own intent; settle the setup-only fixture intent.
  f.journal.settle(f.intent);let child,closed,failed=false;
  const backend={prepare:async()=>{},observe:async()=>{if(failed)throw Error('EXAMPLE');return {complete:true,processes:child?[{pid:child.pid,parentPid:process.pid,created:'639300000000000010'}]:[]};},signal:async()=>assert.fail('no unidentified signal')};
  await assert.rejects(ownedRead({launch:{exe:process.execPath,args:[path.join(__dirname,'fixtures/managed-host-stub.cjs'),'normal','0'],cwd:f.project,env:{EXAMPLE:'only-fixture'}},backend,journal:f.journal,intent:{id:'reader',generation:'reader'},verifyProfile:()=>true,spawnChild:(...args)=>{child=spawn(...args);closed=new Promise(r=>child.once('close',r));return child;},operation:async()=>{failed=true;throw refusal('CFG_PLUGINS_DISABLED');}}),e=>e.ruleId==='CFG_PLUGINS_DISABLED'&&e.recoveryRequired===true&&e.cleanRefusal===false);
  await closed;assert.deepEqual(f.journal.unresolved(),['reader']);
}));

const trustProject=require('node:path').resolve('EXAMPLE');
const configRules=response=>nativeConfigRules(response,trustProject);
