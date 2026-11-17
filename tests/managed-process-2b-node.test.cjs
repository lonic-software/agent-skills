'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {createManagedProcess,bounded}=require('../codex/runtime/managed-process.cjs');
const {createWindowsTreeBackend}=require('../codex/runtime/managed-windows-tree.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fixture=path.join(__dirname,'fixtures/managed-chain-stub.cjs');
async function setup(t,role){
  const osBackend=createWindowsTreeBackend({mode:'managed',commandTimeoutMs:10000});
  // No process is launched if policy blocks the reviewed .ps1 helpers.
  await osBackend.prepare();
  const nonce='EXAMPLE-'+crypto.randomUUID(),registered=new Map(),permitted=new Map(),events=[],timings=[];
  let child;
  async function observe(){
    const start=performance.now(),view=await osBackend.observe();timings.push({operation:'observe',ms:performance.now()-start});
    for(const p of view.processes){const expected=registered.get(p.pid);if(!expected||p.parentPid!==expected.parentPid)continue;if(!permitted.has(p.pid))permitted.set(p.pid,{...p});}
    return view;
  }
  async function signal(p){
    // Independent safety boundary: IPC nonce + own spawn lineage + pinned OS
    // creation identity. No production/arbitrary process can reach signal().
    assert.ok(registered.has(p.pid));assert.deepEqual(p,permitted.get(p.pid));
    const start=performance.now(),reply=await osBackend.signal(p);timings.push({operation:'signal',ms:performance.now()-start});return reply;
  }
  const owner=createManagedProcess({mode:'managed',backend:{prepare:()=>osBackend.prepare(),observe,signal},timeoutMs:15000,closeTimeoutMs:35000,monitorMs:100,pollMs:10,maxRounds:4});
  t.after(async()=>{
    await owner.close({turnCompleted:false});
    const view=await observe();
    for(const p of view.processes.filter(p=>JSON.stringify(p)===JSON.stringify(permitted.get(p.pid))).reverse())await signal(p);
    // No helper is forcibly stopped. Tests only signal registered Node stubs.
    t.diagnostic(JSON.stringify({timings}));
  });
  const start=await owner.start({registeredIntent:{id:nonce,generation:'EXAMPLE'},spawn:()=>{
    child=spawn(process.execPath,[fixture,role,nonce],{windowsHide:true,detached:true,stdio:['pipe','pipe','pipe','ipc']});
    registered.set(child.pid,{parentPid:process.pid});
    child.on('message',m=>{
      if(m?.nonce!==nonce)return;
      if(m.event==='ready'){
        // A leaf is accepted only below the already reported own root/middle.
        assert.ok(m.pid===child.pid || registered.has(m.parentPid));
        registered.set(m.pid,{parentPid:m.parentPid,role:m.role});
      }
      events.push(m);
    });return child;
  }});
  assert.equal(start.allowed,true,JSON.stringify(start));
  async function until(predicate,ms=12000){const end=performance.now()+ms;while(!predicate() && performance.now()<end)await sleep(25);return predicate();}
  child.send({nonce,action:'spawn'});
  assert.equal(await until(()=>events.some(e=>e.role==='leaf')),true,'own leaf announces readiness');
  // Hold the intermediate live long enough for periodic discovery. In the S4
  // mutation this expires deliberately; the final false-success assertion is
  // still executed, rather than failing merely on a missing scan count.
  await until(()=>owner.status().registeredMembers===(role==='chain-root'?3:2),8000);
  await observe(); // Independent signal allowlist, never registers owner members.
  return {owner,child,nonce,events,until,observe,permitted,registered};
}
test('S4/S11 real Node intermediate exits; registered grandchild is cleaned before continuation',{skip:process.platform!=='win32',timeout:60000},async t=>{
  const f=await setup(t,'chain-root'),middle=f.events.find(e=>e.role==='middle'),leaf=f.events.find(e=>e.role==='leaf');
  f.child.send({nonce:f.nonce,action:'exit-middle'});
  assert.equal(await f.until(()=>f.events.some(e=>e.event==='nested-exited'&&e.pid===middle.pid)),true);
  const before=await f.observe();assert.ok(before.processes.some(p=>p.pid===leaf.pid));assert.ok(!before.processes.some(p=>p.pid===middle.pid));
  const result=await f.owner.close({turnCompleted:true});
  assert.equal(result.allowed,true,'S11: a successfully cleaned registered orphan permits continuation');
  assert.equal(result.recoveryRequired,false);
  const after=await f.observe();assert.ok(!after.processes.some(p=>p.pid===leaf.pid&&p.created===f.permitted.get(leaf.pid)?.created),'identified orphan was cleaned up');
});
test('S5 real Node unfinished turn cleans parent and child but forbids continuation',{skip:process.platform!=='win32',timeout:60000},async t=>{
  const f=await setup(t,'pair-root'),leaf=f.events.find(e=>e.role==='leaf');
  const result=await f.owner.close({turnCompleted:false});
  assert.equal(result.allowed,false);assert.equal(result.recoveryRequired,true);
  const after=await f.observe();
  assert.ok(!after.processes.some(p=>(p.pid===f.child.pid || p.pid===leaf.pid)&&p.created===f.permitted.get(p.pid)?.created),'S5: unfinished turn must not leave its own live tree');
  assert.equal(result.cleanupObserved,true);
});
