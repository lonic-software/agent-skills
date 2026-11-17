'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const modulePath=path.resolve(__dirname,'../codex/runtime/queue-checkpoint.cjs');
const {writeCheckpoint,readCheckpoint,claimCheckpoint}=require(modulePath);
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'lonic-checkpoint-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root}
function data(){return {runId:'EXAMPLE-RUN',itemId:'EXAMPLE-ITEM',queue:'EXAMPLE-QUEUE.txt#first',entrySkill:'queue-run',authority:'Local changes only; no commit, push, PR, merge or install',resumePrompt:'$queue-run Continue from the recorded checkpoint; verify current source and usage first.',completedChecks:[],openFindings:['EXAMPLE unresolved review finding'],blockedItems:[],nextActions:['Read the queue again'],sourceState:[{path:'EXAMPLE-untracked.txt',status:'untracked',sha256:'EXAMPLE-DIGEST'}],exclusions:['No publication'],budget:{schema:1,runId:'EXAMPLE-RUN',threshold:60,resetsAt:1800000000}}}
test('fresh process reads exact authority, untracked state and unresolved findings',t=>{
 const saved=writeCheckpoint(fixture(t),'phase-1',data());
 const run=spawnSync(process.execPath,['-e','process.stdout.write(JSON.stringify(require(process.argv[1]).readCheckpoint(process.argv[2]).data))',modulePath,saved.file],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),data());
});
test('immutable checkpoint rejects duplicate publication and preserves the original',t=>{
 const root=fixture(t),saved=writeCheckpoint(root,'phase-1',data());const next=data();next.authority='DIFFERENT';
 assert.throws(()=>writeCheckpoint(root,'phase-1',next),{code:'EEXIST'});assert.equal(readCheckpoint(saved.file).data.authority,data().authority);
 assert.deepEqual(fs.readdirSync(root),['phase-1.json']);
});
test('partial or corrupted files cannot launch a continuation',t=>{
 const saved=writeCheckpoint(fixture(t),'phase-1',data());fs.writeFileSync(saved.file,'{"schema":1');assert.throws(()=>readCheckpoint(saved.file));
 fs.writeFileSync(saved.file,JSON.stringify({schema:1,payload:JSON.stringify(data()),sha256:'incorrect'}));assert.throws(()=>readCheckpoint(saved.file),/corrupt/);
 assert.equal(fs.existsSync(saved.file+'.claimed'),false);
});
test('only one consumer claims a checkpoint, including after its process ends',t=>{
 const saved=writeCheckpoint(fixture(t),'phase-1',data());
 const first=spawnSync(process.execPath,['-e','require(process.argv[1]).claimCheckpoint(process.argv[2],process.argv[3],"EXAMPLE-CONSUMER")',modulePath,saved.file,saved.sha256],{encoding:'utf8'});
 assert.equal(first.status,0,first.stderr);assert.throws(()=>claimCheckpoint(saved.file,saved.sha256,'second'),{code:'EEXIST'});
});
test('mismatched identity, missing authority and wrong wrapper are rejected',t=>{
 const root=fixture(t);for(const mutate of [d=>delete d.authority,d=>d.budget.runId='different',d=>d.resumePrompt='$powerup unrelated',d=>d.nextActions=[]]){const d=data();mutate(d);assert.throws(()=>writeCheckpoint(root,'phase',d))}
 assert.deepEqual(fs.readdirSync(root),[]);const saved=writeCheckpoint(root,'phase',data());assert.throws(()=>claimCheckpoint(saved.file,'wrong','consumer'),/changed/);
});
test('path traversal and symbolic-link destinations are refused',t=>{
 const root=fixture(t);assert.throws(()=>writeCheckpoint(root,'../escape',data()),/Invalid/);
 const real=path.join(root,'real'),link=path.join(root,'link');fs.mkdirSync(real);fs.symlinkSync(real,link,process.platform==='win32'?'junction':'dir');
 assert.throws(()=>writeCheckpoint(link,'phase',data()),/links/);assert.deepEqual(fs.readdirSync(real),[]);
});
