'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {runQueue}=require('../codex/runtime/queue-controller.cjs');
const {accountFingerprint}=require('../codex/runtime/managed-admission.cjs');
test('single managed author protocol completes over an actual own Node child and fresh pipes',async()=>{
  let child,spawns=0,closed=false;const order=[];const now=1800000000000;
  const account={account:{type:'chatgpt'},workspaceRouting:{chatgptAccountId:'EXAMPLE-account',backendOrigin:'EXAMPLE-origin'}},usage={accountId:'EXAMPLE-account'};
  const instructions={complete:true,scopeKey:'EXAMPLE',sources:[{key:'host:developer',identity:'EXAMPLE',sha256:crypto.createHash('sha256').update('EXAMPLE').digest('hex')}]};
  const config={runId:'EXAMPLE-node-run',budget:{runId:'EXAMPLE-node-run',absolute:60},task:{kind:'file',locator:'EXAMPLE-task.md',itemId:'fixed-item'},authority:'EXAMPLE no filesystem work',exclusions:[],selection:{model:'gpt-6.1-sol',provider:'openai',effort:'medium'},instructions,enrollment:{schema:1,algorithm:'m2-account-v1',fingerprint:accountFingerprint(account,usage)},developerInstructions:'EXAMPLE',timeoutMs:5000,processTimeoutMs:2000,closeTimeoutMs:2000,launch:{exe:process.execPath,args:[path.join(__dirname,'fixtures/managed-author-stub.cjs')],cwd:__dirname,env:{CODEX_HOME:'EXAMPLE-unread',SystemRoot:process.env.SystemRoot||'EXAMPLE',TEMP:process.env.TEMP||'EXAMPLE',TMP:process.env.TMP||'EXAMPLE'}}};
  const row=()=>({pid:child.pid,parentPid:process.pid,created:'100'});
  const host={now:()=>now,gate:{acquire:async()=>({allowed:true}),check:async()=>({allowed:true}),release:async()=>{order.push('release');return {allowed:true}}},
    inspect:async scope=>({instructions,hooks:{complete:true,scope,errors:[],warnings:[],hooks:[]}}),verifyInputs:()=>true,registerIntent:async()=>order.push('intent'),settleIntent:async()=>{assert.equal(closed,true);order.push('settled');return true},
    spawn:(exe,args,options)=>{spawns++;order.push('spawn');assert.deepEqual(Object.keys(options.env).sort(),['CODEX_HOME','SystemRoot','TEMP','TMP'].sort());child=spawn(exe,args,{...options,detached:true});child.once('close',()=>{closed=true;order.push('close')});return child},
    // Instrumented test-owned child handle, not a claim of Windows OS inventory.
    backend:{observe:async()=>({complete:true,processes:child&&!closed&&child.exitCode===null&&child.signalCode===null?[row()]:[]}),signal:async p=>{assert.deepEqual(p,row());assert.equal(child.pid,p.pid);if(child.exitCode!==null||child.signalCode!==null)return {verified:true,status:'gone'};child.kill();return {verified:true,status:'signalled'}}}
  };
  const result=await runQueue({managed:true,managedRun:config},{managed:host});
  assert.equal(result.status,'author-complete',JSON.stringify(result));assert.equal(result.handoff.status,'done');assert.equal(result.continuationStarted,false);assert.equal(spawns,1);
  assert.ok(order.indexOf('intent')<order.indexOf('spawn'));assert.ok(order.indexOf('close')<order.indexOf('settled'));assert.ok(order.indexOf('settled')<order.indexOf('release'));
});
