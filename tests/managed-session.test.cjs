'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {runQueue}=require('../codex/runtime/queue-controller.cjs');
const {accountFingerprint}=require('../codex/runtime/managed-admission.cjs');
const {createManagedRunBudget}=require('../codex/runtime/managed-run-budget.cjs');
const {createManagedRpc}=require('../codex/runtime/managed-rpc.cjs');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const now=1800000000000,selection={model:'gpt-6.2-sol',provider:'openai',effort:'medium'};
const instructions={complete:true,scopeKey:'EXAMPLE-bounded-inputs',sources:[{key:'host:developer',identity:'EXAMPLE-grant',sha256:hash('EXAMPLE developer')}]};
const account=()=>({account:{type:'chatgpt',email:'PRIVATE-email'},workspaceRouting:{chatgptAccountId:'PRIVATE-account',backendOrigin:'PRIVATE-origin'}});
const usage=()=>({accountId:'PRIVATE-account',ordinaryUsageAllowed:true,rateLimits:{limitId:'codex',primary:{windowDurationMins:300,usedPercent:10,resetsAt:now/1000+3600},secondary:{windowDurationMins:10080,usedPercent:25,resetsAt:now/1000+604800}}});
const context=()=>({summary:'EXAMPLE work',completedChecks:['unit check'],openFindings:[],nextActions:['report'],sourceState:[{path:'sample.txt',state:'checked'}]});
const handoff=()=>({status:'continue',reason:'EXAMPLE boundary',itemId:'fixed-item',context:context()});
function setup(variant='normal'){
  const events=[],sent=[],audits=[],steps=[],abort=new AbortController();let child,closed=false,spawns=0,quota=0,settles=0,releases=0;
  const budget={runId:'EXAMPLE-run',absolute:60};
  const options={managed:true,signal:abort.signal,budgetFile:'MUST-NOT-READ',resumePrompt:'POISON-LEGACY-RESUME',managedRun:{runId:budget.runId,budget,selection:{...selection},instructions:structuredClone(instructions),enrollment:{schema:1,algorithm:'m2-account-v1',fingerprint:accountFingerprint(account(),usage())},task:{kind:'file',locator:'EXAMPLE-task.md',itemId:'fixed-item'},authority:'EXAMPLE bounded task',exclusions:['No publication'],developerInstructions:'EXAMPLE developer',launch:{exe:'EXAMPLE-never-executed',args:[],cwd:'EXAMPLE-project',env:{CODEX_HOME:'EXAMPLE-profile-not-read',SystemRoot:'EXAMPLE-system',TEMP:'EXAMPLE-temp',TMP:'EXAMPLE-temp'}},timeoutMs:2000,processTimeoutMs:500,closeTimeoutMs:500}};
  const row=()=>({pid:910001,parentPid:process.pid,created:'100'});
  function finish(){if(closed)return;closed=true;child.emit('exit',0);child.stdout.emit('close');child.stderr.emit('close');child.emit('close',0);}
  function emit(value){child.stdout.write(JSON.stringify(value)+'\n');}
  function tool(name,args,id=100,threadId='thread-1'){return {id,method:'item/tool/call',params:{threadId,turnId:'turn-1',callId:'call-'+id,tool:name,arguments:args}};}
  const host={now:()=>now,runBudget:createManagedRunBudget({mode:'managed',grant:budget}),
    gate:{acquire:async()=>{steps.push('gate-acquire');return {allowed:true}},check:async()=>({allowed:true}),release:async()=>{releases++;return {allowed:true}}},
    inspect:async(scope,thread)=>{steps.push('inspect-'+scope);return {instructions:structuredClone(instructions),hooks:{complete:true,scope,errors:[],warnings:[],hooks:variant==='hook'?[{known:true,enabled:true}]:[]}}},
    verifyInputs:boundary=>{steps.push(boundary);return !(variant==='drift'&&boundary==='before-turn')},
    registerIntent:async()=>steps.push('intent'),settleIntent:async()=>{settles++;return true},audit:e=>audits.push(e),
    backend:{observe:async()=>({complete:true,processes:child&&!closed?[row()]:[]}),signal:async p=>{assert.deepEqual(p,row());finish();return {verified:true,status:'signalled'}}},
    spawn:(exe,args,opts)=>{
      spawns++;steps.push('spawn');assert.equal(exe,'EXAMPLE-never-executed');assert.deepEqual(Object.keys(opts.env).sort(),['CODEX_HOME','SystemRoot','TEMP','TMP'].sort());
      child=new EventEmitter();child.pid=910001;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
      child.stdin.on('finish',()=>queueMicrotask(finish));let buffer='';
      child.stdin.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const m=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);sent.push(m);
        if(m.method==='initialize')emit({id:m.id,result:{}});
        else if(m.method==='account/read'){if(sent.filter(x=>x.method==='account/read').length===1)emit({method:'account/updated',params:{authMode:'chatgpt'}});const a=account();if(variant==='account-change'&&quota>=1)a.workspaceRouting.chatgptAccountId='OTHER';emit({id:m.id,result:a});}
        else if(m.method==='account/rateLimits/read'){quota++;if(variant==='pending-cancel'&&quota===3){queueMicrotask(()=>abort.abort());continue;}emit({id:m.id,result:usage()});}
        else if(m.method==='thread/start')emit({id:m.id,result:{thread:{id:'thread-1'},model:selection.model,modelProvider:selection.provider,reasoningEffort:selection.effort,instructionSources:[]}});
        else if(m.method==='turn/start'){
          const next=variant==='approval'?{id:100,method:'item/commandExecution/requestApproval',params:{command:'PRIVATE-operator-text'}}:tool('lonic_context',{},100,variant==='foreign'?'foreign-thread':'thread-1');
          // Deliberately one stdout chunk: reply binding must precede request.
          child.stdout.write(JSON.stringify({id:m.id,result:{turn:{id:'turn-1'}}})+'\n'+JSON.stringify(next)+'\n');
        }else if(m.method==='turn/interrupt')emit({id:m.id,result:{}});
        else if(m.id===100&&m.result){events.push(JSON.parse(m.result.contentItems[0].text));
          if(variant==='missing'){emit({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});continue;}
          const args=handoff();if(variant==='poison')args.operatorDecisions=['PRIVATE-decision'];
          emit(tool('lonic_handoff',args,101));if(variant==='duplicate')emit(tool('lonic_handoff',handoff(),102));
        }else if(m.id===101&&m.result){events.push(JSON.parse(m.result.contentItems[0].text));emit({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});}
      }});return child;
    }
  };
  return {options,host,abort,events,sent,audits,steps,run:()=>runQueue(options,{managed:host,readUsage:()=>assert.fail('Legacy metering must not run'),runSession:()=>assert.fail('Legacy author must not run')}),get spawns(){return spawns},get closed(){return closed},get releases(){return releases},get settles(){return settles}};
}
test('one managed author uses only memory context/handoff and observed teardown',async()=>{
  const f=setup(),result=await f.run();assert.equal(result.status,'author-complete');assert.equal(result.continuationStarted,false);assert.equal(f.spawns,1);assert.equal(f.closed,true);assert.equal(f.settles,1);assert.equal(f.releases,1);
  assert.deepEqual(result.handoff,{schema:2,...handoff()});assert.equal(f.events[0].usage.threshold,60);assert.equal(f.events[1].saved,true);
  assert.ok(f.steps.indexOf('intent')<f.steps.indexOf('spawn'));assert.ok(f.steps.indexOf('before-turn')>f.steps.indexOf('inspect-thread'));
  const outward=JSON.stringify({result,events:f.events,audits:f.audits,prompt:f.sent.find(x=>x.method==='turn/start').params});assert.doesNotMatch(outward,/PRIVATE-|POISON|budgetFile|accountDigest|fingerprint|operatorDecisions/);
});
for(const variant of ['approval','foreign','poison','duplicate','missing','account-change','drift','pending-cancel'])test('managed '+variant+' refuses, cleans and never starts a successor',async()=>{
  const f=setup(variant),result=await f.run();assert.equal(result.status,['account-change','drift'].includes(variant)?'refused':'needs-reconciliation');assert.equal(result.continuationStarted,false);assert.equal(f.spawns,1);assert.equal(f.closed,true);
  assert.equal(result.handoff,undefined);assert.doesNotMatch(JSON.stringify(result),/PRIVATE-|POISON/);
  if(['account-change','drift'].includes(variant))assert.equal(f.sent.some(m=>m.method==='turn/start'),false);
  if(['approval','foreign','pending-cancel'].includes(variant))assert.ok(f.sent.some(m=>m.method==='turn/interrupt'));
});
test('enabled native hook refuses before author spawn, including the bundled filter',async()=>{const f=setup('hook');assert.equal((await f.run()).status,'refused');assert.equal(f.spawns,0)});
test('no host adapters or an ambient environment cannot silently enter legacy/native mode',async()=>{
  assert.equal((await runQueue({managed:true})).reason,'MANAGED_SETUP_INVALID');const f=setup();f.options.managedRun.launch.env.EXTRA='not-allowed';assert.equal((await f.run()).reason,'MANAGED_SETUP_INVALID');assert.equal(f.spawns,0);
});
test('grant is captured before awaits and cannot be replaced by later caller edits',async()=>{
  const f=setup(),inspect=f.host.inspect;f.host.inspect=async(...args)=>{f.options.managedRun.authority='POISON-new-authority';f.options.managedRun.budget.absolute=99;return inspect(...args)};
  const result=await f.run();assert.equal(result.status,'author-complete');assert.equal(f.events[0].usage.threshold,60);assert.doesNotMatch(JSON.stringify(f.sent.find(x=>x.method==='turn/start')),/POISON/);
});
test('revoked managed RPC handler emits neither late success nor raw error',async()=>{
  for(const reject of [false,true]){
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();let output='';child.stdin.on('data',d=>output+=d);let complete;
    const pending=new Promise((res,rej)=>complete=reject?rej:res);const rpc=createManagedRpc(child,{canReply:()=>true,onRequest:()=>pending});
    child.stdout.write(JSON.stringify({id:9,method:'request'})+'\n');await Promise.resolve();rpc.revoke();complete(reject?Error('PRIVATE-error'):{secret:'PRIVATE-success'});await new Promise(r=>setImmediate(r));assert.equal(output,'');rpc.dispose();
  }
});
