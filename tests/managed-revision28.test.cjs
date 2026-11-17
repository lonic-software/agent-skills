'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{PassThrough}=require('node:stream'),{createHash}=require('node:crypto');
const {projectTrusted}=require('../codex/runtime/managed-project-trust.cjs');
const {developerInstructions,PERMISSIONS}=require('../codex/runtime/managed-instructions.cjs');
const {createInventory}=require('../codex/runtime/managed-inventory.cjs');
const {hostFixture}=require('./fixtures/managed-host-fixture.cjs');
const {main}=require('../codex/runtime/managed-cli.cjs');
const {fixture}=require('./fixtures/managed-run-fixture.cjs');
const {auditNotification}=require('../codex/runtime/managed-notification-audit.cjs');
const {replay}=require('./fixtures/managed-config-replay.cjs');
const {configRules}=require('../codex/runtime/managed-inventory-rules.cjs');

test('S28 requires exact explicit Windows project trust and rejects ambiguous or inferred trust',()=>{
  const cwd='C:\\Example\\Project',key=cwd.toLowerCase(),trusted={[key]:{trust_level:'trusted'}};
  assert.equal(projectTrusted(trusted,cwd),true);
  for(const entries of [undefined,null,[],{}, {[key]:{trust_level:'untrusted'}},{[key]:{trust_level:true}},{[key]:{trusted:true}},{[key]:{trust_level:'trusted',unknown:true}},{[key.replaceAll('\\','/')]:{trust_level:'trusted'}},{'c:\\example':{trust_level:'trusted'}},{[key+'-other']:{trust_level:'trusted'}},{...trusted,[cwd]:{trust_level:'untrusted'}}])assert.equal(projectTrusted(entries,cwd),false);
  for(const project of [undefined,'relative','C:Example','\\\\?\\C:\\Example\\Project','C:\\Example\\..\\Example\\Project'])assert.equal(projectTrusted(trusted,project),false);
  assert.equal(configRules(replay()).find(r=>r.ruleId==='CFG_PROJECT_TRUSTED').passed,false,'omitted project cannot bypass trust');
});

test('S28 enrollment CLI returns a clear clean refusal before prompt/thread with settled journal', {skip:process.platform!=='win32'},()=>hostFixture(async f=>{
  const runtime=path.join(f.root,'runtime.json');fs.writeFileSync(runtime,JSON.stringify({schema:1,codex:process.execPath,model:'gpt-6.1-sol'}));
  const stderr=new PassThrough(),stdout=new PassThrough();let diagnostic='';stderr.on('data',b=>diagnostic+=b);
  const code=await main(['--managed','--enroll','--config',runtime,'--project',f.project,'--profile',f.profile,'--state-root',f.stateRoot],{stdout,stderr,terminal:{inputTTY:true,outputTTY:true,confirm:()=>assert.fail('no prompt before project trust')},createHost:cfg=>f.createHost(cfg)});
  assert.equal(code,4);const result=JSON.parse(diagnostic.trim());assert.equal(result.ruleId,'CFG_PROJECT_TRUSTED');assert.equal(result.recoveryRequired,false);assert.match(result.diagnostic,/before any thread/);assert.doesNotMatch(diagnostic,/PRIVATE/);
  assert.equal(f.methods.includes('thread/start'),false);assert.equal(f.methods.includes('turn/start'),false);
  const host=f.createHost();const journal=JSON.parse(fs.readFileSync(path.join(path.dirname(host.enrollmentPath),'intent.json')));assert.equal(journal.status,'settled');assert.ok(journal.intents.every(i=>i.status==='settled'));
  const audit=fs.readFileSync(path.join(path.dirname(host.enrollmentPath),'notifications.jsonl'),'utf8');assert.doesNotMatch(audit,/PRIVATE|params|example/);assert.ok(audit.includes('remoteControl/status/changed'));
},'untrusted'));

test('S28 managed prepare refuses untrusted project before author creation without recovery', {skip:process.platform!=='win32'},()=>hostFixture(async f=>{
  const host=f.createHost();host.storeEnrollment({schema:1,algorithm:'m2-account-v1',fingerprint:'a'.repeat(64)});
  await assert.rejects(host.prepare(),e=>e.ruleId==='CFG_PROJECT_TRUSTED'&&e.cleanRefusal&&e.recoveryRequired===false);
  assert.equal(f.methods.includes('thread/start'),false);const journal=JSON.parse(fs.readFileSync(path.join(path.dirname(host.enrollmentPath),'intent.json')));assert.equal(journal.status,'settled');await host.dispose();
},'untrusted'));

test('S26 actual host developer text includes cwd and boundaries and its exact bytes are pinned', {skip:process.platform!=='win32'},()=>hostFixture(async f=>{
  const host=f.createHost();host.storeEnrollment({schema:1,algorithm:'m2-account-v1',fingerprint:'a'.repeat(64)});
  try{const grant=await host.prepare();assert.ok(grant.developerInstructions.includes(JSON.stringify(f.project)));assert.ok(grant.developerInstructions.includes(PERMISSIONS));assert.match(grant.developerInstructions,/approvalPolicy never/);
    const text=developerInstructions(require('../codex/runtime/managed-host.cjs').DEVELOPER,f.project),sha=createHash('sha256').update(text).digest('hex');assert.equal(grant.instructions.sources.find(s=>s.key==='host:developer').sha256,sha);
    assert.notEqual(text,developerInstructions(require('../codex/runtime/managed-host.cjs').DEVELOPER,f.project+'-different'));
    assert.equal((await host.host.gate.release()).allowed,true);
  }finally{await host.dispose();}
}));

for(const method of ['remoteControl/status/changed','EXAMPLE/futureNotification','account/updated'])test('notification audit contains method only: '+method,async()=>{
  const f=fixture('one-author'),spawn=f.host.spawn,rows=[];f.host.audit=row=>rows.push(row);
  f.host.spawn=()=>{const child=spawn(),write=child.stdin.write.bind(child.stdin);child.stdin.write=(bytes,...rest)=>{const m=JSON.parse(String(bytes));if(m.method==='turn/start')child.stdout.write(JSON.stringify({method,params:{secret:'PRIVATE-payload'}})+'\n');return write(bytes,...rest);};return child;};
  const result=await f.run();assert.equal(result.status,method==='account/updated'?'needs-reconciliation':'completed');
  assert.deepEqual(rows.filter(r=>r.event==='native-notification'&&r.method===method),[{event:'native-notification',method}]);assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|secret|params/);
});
test('notification sink failure never changes notification handling',()=>{assert.doesNotThrow(()=>auditNotification(()=>{throw Error('EXAMPLE');},{method:'EXAMPLE/notice',params:{secret:'PRIVATE'}}));});
