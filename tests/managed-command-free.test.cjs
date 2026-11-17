'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {developerInstructions,PERMISSIONS}=require('../codex/runtime/managed-instructions.cjs');
const {hostFixture}=require('./fixtures/managed-host-fixture.cjs');
const {fixture}=require('./fixtures/managed-run-fixture.cjs');
test('command-execution prohibition is sent in the real host grant and covered by its instruction hash',{skip:process.platform!=='win32'},()=>hostFixture(async f=>{
 const host=f.createHost();host.storeEnrollment({schema:1,algorithm:'m2-account-v1',fingerprint:'a'.repeat(64)});
 try{const grant=await host.prepare(),text=developerInstructions(require('../codex/runtime/managed-host.cjs').DEVELOPER,f.project);
  assert.ok(grant.developerInstructions.includes(PERMISSIONS));assert.match(text,/disables environment access with environments: \[\]/);assert.match(text,/Command execution is not authorized or supported/);assert.match(text,/even if exec_command, write_stdin or another execution tool is exposed/);assert.match(text,/Do not invoke command-execution tools/);assert.match(text,/hand off stop with the missing capability/);
  assert.equal(grant.instructions.sources.find(s=>s.key==='host:developer').sha256,createHash('sha256').update(text).digest('hex'));assert.equal((await host.host.gate.release()).allowed,true);
 }finally{await host.dispose();}
}));
test('managed thread retains an empty environment list without a turn override',async()=>{
 const f=fixture('one-author'),spawn=f.host.spawn,requests=[];
 f.host.spawn=()=>{const child=spawn(),write=child.stdin.write.bind(child.stdin);child.stdin.write=(bytes,...args)=>{const m=JSON.parse(String(bytes));if(m.method)requests.push(m);return write(bytes,...args);};return child;};
 assert.equal((await f.run()).status,'completed');assert.deepEqual(requests.find(m=>m.method==='thread/start').params.environments,[]);
 assert.equal(Object.hasOwn(requests.find(m=>m.method==='turn/start').params,'environments'),false);
});
