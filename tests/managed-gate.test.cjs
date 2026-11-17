'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createManagedGate}=require('../codex/runtime/managed-gate.cjs');
function fixture(){
  let loss=()=>{};const expectedIdentity={key:'EXAMPLE-gate',identity:'EXAMPLE-inode'},registeredIntent={id:'EXAMPLE-intent'};
  const sample={locked:true,ownerBound:true,ownerAlive:true,intentId:registeredIntent.id,gate:expectedIdentity,helper:{pid:901001,created:'100'}};
  const adapter={onLoss:f=>loss=f,open:async()=>sample,observe:async()=>sample,release:async()=>({exited:true,stdoutClosed:true,stderrClosed:true,handlers:0,survivors:[]})};
  const stops=[];const gate=createManagedGate({mode:'managed',expectedIdentity,registeredIntent,adapter,onStop:c=>stops.push(c),timeoutMs:30});
  return {gate,adapter,sample,stops,loss:()=>loss()};
}
test('only verified owner-bound gate helper may survive between authors',async()=>{
  const f=fixture();assert.equal((await f.gate.acquire()).allowed,true);assert.equal((await f.gate.check({survivors:[f.sample.helper]})).allowed,true);assert.equal((await f.gate.release()).allowed,true);
});
test('registered gate identity mismatch refuses before any author can be admitted',async()=>{
  const f=fixture();f.adapter.open=async()=>({...f.sample,gate:{...f.sample.gate,identity:'REPLACED'}});assert.equal((await f.gate.acquire()).allowed,false);assert.equal((await f.gate.check()).allowed,false);
});
for(const variant of ['owner-eof','helper-first','owner-first'])test('gate loss latches for '+variant,async()=>{
  const f=fixture();await f.gate.acquire();
  if(variant==='owner-first')f.sample.ownerAlive=false;else f.loss();
  assert.equal((await f.gate.check()).allowed,false);f.loss();f.sample.ownerAlive=true;assert.equal((await f.gate.check()).allowed,false);assert.equal(f.stops.length,1);
});
test('helper loss during acquisition cannot be overwritten by a late locked reply',async()=>{
  const f=fixture();let resolve;f.adapter.open=()=>new Promise(r=>resolve=r);const waiting=f.gate.acquire();await Promise.resolve();f.loss();resolve(f.sample);assert.equal((await waiting).allowed,false);
});
test('unrelated survivor, reused helper PID and unresolved intent each refuse',async()=>{
  for(const kind of ['survivor','reuse','intent']){const f=fixture();await f.gate.acquire();const args=kind==='intent'?{unresolvedIntents:['pending']}:kind==='survivor'?{survivors:[{pid:991001,created:'9'}]}:{};if(kind==='reuse')f.sample.helper={...f.sample.helper,created:'999'};assert.equal((await f.gate.check(args)).allowed,false);}
});
test('release requires observed helper exit, both channels, handlers and no survivors',async()=>{
  for(const change of [{exited:false},{stdoutClosed:false},{stderrClosed:false},{handlers:1},{survivors:[{pid:1}]}]){const f=fixture();await f.gate.acquire();const original=f.adapter.release;f.adapter.release=async()=>({...await original(),...change});assert.equal((await f.gate.release()).allowed,false);}
});
test('gate deadline revokes immediately and never reacquires',async()=>{
  const f=fixture();await f.gate.acquire();f.adapter.observe=()=>new Promise(()=>{});assert.equal((await f.gate.check()).allowed,false);assert.equal((await f.gate.acquire()).allowed,false);
});
