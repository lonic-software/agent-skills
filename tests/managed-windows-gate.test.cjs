'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {createWindowsGateAdapter,gateIdentity}=require('../codex/runtime/managed-windows-gate.cjs');
const {createManagedGate}=require('../codex/runtime/managed-gate.cjs');
const {bounded}=require('../codex/runtime/managed-process.cjs');
async function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lonic-step2-gate-')),file=path.join(dir,'gate.lock'),nonce='EXAMPLE-'+crypto.randomUUID();fs.writeFileSync(file,nonce);
  let child;const stops=[];
  const adapter=createWindowsGateAdapter({mode:'managed',gatePath:file,timeoutMs:1500,adapters:{
    tree:{observe:async()=>({complete:true,processes:[{pid:process.pid,parentPid:0,created:'10'},...(child && child.exitCode===null?[{pid:child.pid,parentPid:process.pid,created:'11'}]:[])]})},
    spawnHelper:()=>{child=spawn(process.execPath,[path.join(__dirname,'fixtures','managed-node-stub.cjs'),'gate-protocol',nonce],{windowsHide:true,detached:true,stdio:['pipe','pipe','pipe','ipc']});return child;}
  }});
  t.after(async()=>{
    if(child && child.exitCode===null){const closed=new Promise(resolve=>child.once('close',resolve));child.stdin.end();await bounded(()=>closed,3000);}
    assert.equal(path.dirname(fs.realpathSync(dir)),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(dir).startsWith('lonic-step2-gate-'));fs.rmSync(dir,{recursive:true});
  });
  const gate=createManagedGate({mode:'managed',expectedIdentity:gateIdentity(file),registeredIntent:{id:nonce},adapter,onStop:code=>stops.push(code),timeoutMs:3000});
  assert.equal((await gate.acquire()).allowed,true);
  return {gate,adapter,child,nonce,stops,file};
}
test('Windows gate transport with own Node stub observes handshake, ping, EOF and final release',{skip:process.platform!=='win32'},async t=>{
  const f=await setup(t);assert.equal((await f.gate.check()).allowed,true);assert.equal((await f.gate.release()).allowed,true);assert.deepEqual(f.stops,[]);
});
test('Windows gate transport loss of own Node helper revokes admission',{skip:process.platform!=='win32'},async t=>{
  const f=await setup(t);const closed=new Promise(resolve=>f.child.once('close',resolve));f.child.send({nonce:f.nonce,action:'exit'});await bounded(()=>closed,3000);
  assert.equal((await f.gate.check()).allowed,false);assert.equal(f.stops.length,1);
});
test('Windows gate transport refuses changed registered pathname identity',{skip:process.platform!=='win32'},async t=>{
  const f=await setup(t);fs.renameSync(f.file,f.file+'.original');fs.writeFileSync(f.file,'EXAMPLE-replacement');
  assert.equal((await f.gate.check()).allowed,false);
});
