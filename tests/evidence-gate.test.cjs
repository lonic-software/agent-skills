'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createBoundGate,TOOL_SETS,summarizeGateAudit,readScopeInstructions}=require('../codex/runtime/bound-grounder-gate.cjs');
const {assessAttack}=require('../codex/runtime/attack-result.cjs');
const catalog={tools:['brief','check','look','run','fact','record','query','workspaces','claim','render'].map(name=>({name,inputSchema:{type:'object'}}))};
function setup(t,{mode='grounder',allowedCommands=[],respond}={}){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'lonic-bound-gate-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const repo=path.join(base,'source'),memo=path.join(base,'memo.md');fs.mkdirSync(repo);fs.writeFileSync(path.join(repo,'example.txt'),'EXAMPLE DATA\n');fs.writeFileSync(memo,'EXAMPLE MEMO\n');fs.mkdirSync(memo+'.tetel');fs.writeFileSync(path.join(memo+'.tetel','artifact.txt'),'EXAMPLE ARTIFACT\n');
 const job={mode,repo,workspace:'EXAMPLE-'+mode,memo,pin:'a'.repeat(40),allowedCommands};const calls=[],audit=[];
 const gate=createBoundGate(catalog,async(m,p)=>{calls.push(p);return (respond&&await respond(p,job))||{content:[{type:'text',text:p.name==='run'?JSON.stringify({exit_code:0,output:job.pin+'\n'}):'EXAMPLE RESULT'}]}},job,e=>audit.push(e));
 const call=(name,args={})=>gate.request('tools/call',{name,arguments:args});
 return {base,repo,memo,job,calls,audit,gate,call,pin:()=>call('run',{workspace:job.workspace,command:['git','-C',fs.realpathSync(repo),'rev-parse','HEAD']})};
}
test('each mode exposes exactly its seven tetel operations',async t=>{for(const mode of ['grounder','attacker']){const s=setup(t,{mode});assert.deepEqual((await s.gate.request('tools/list')).tools.map(t=>t.name),TOOL_SETS[mode]);await assert.rejects(s.call(mode==='grounder'?'check':'brief',{}));assert.equal(s.calls.length,0)}});
test('grounder cannot open the memo or its artifacts; attacker may capture both',async t=>{
 for(const mode of ['grounder','attacker'])for(const artifact of [false,true]){const s=setup(t,{mode});await s.pin();const target=artifact?path.join(s.memo+'.tetel','artifact.txt'):s.memo;const result=await s.call('look',{workspace:s.job.workspace,path:target});if(mode==='grounder'){assert.equal(result.isError,true);assert.equal(result.structuredContent.code,'READ_SCOPE_DENIED');assert.equal(s.calls.length,1)}else{assert.notEqual(result.isError,true);assert.equal(s.calls.length,2)}}
});
test('wrong workspace, foreign memo and external file access never reach tetel',async t=>{
 for(const action of ['workspace','memo','path']){const s=setup(t,{mode:'attacker'});await s.pin();const req=action==='workspace'?s.call('query',{workspace:'EXAMPLE-AUTHOR',what:'facts'}):action==='memo'?s.call('check',{file:path.join(s.base,'other.md')}):s.call('look',{workspace:s.job.workspace,path:__filename});if(action==='path')assert.equal((await req).isError,true);else await assert.rejects(req);assert.equal(s.calls.length,1)}
});
test('recursive source read refuses nested links before forwarding',async t=>{
 const s=setup(t);fs.symlinkSync(s.base,path.join(s.repo,'outside'),process.platform==='win32'?'junction':'dir');await s.pin();await assert.rejects(s.call('look',{workspace:s.job.workspace,path:s.repo,grep:'EXAMPLE'}),/symlink|junction/);assert.equal(s.calls.length,1);
});
test('regular recursive search is forwarded and captured by tetel',async t=>{const s=setup(t);await s.pin();await s.call('look',{workspace:s.job.workspace,path:s.repo,grep:'EXAMPLE'});assert.equal(s.calls.at(-1).name,'look')});
test('predeclared commands require an exact match and a successful pin first',async t=>{
 for(const variant of ['valid','changed','before-pin']){const command=['EXAMPLE-program','EXAMPLE-test'];const s=setup(t,{allowedCommands:[command]});if(variant!=='before-pin')await s.pin();const result=s.call('run',{workspace:s.job.workspace,command:variant==='changed'?[...command,'--extra']:command});if(variant==='valid')await result;else await assert.rejects(result,/exact predeclared/);assert.equal(s.calls.length,variant==='valid'?2:variant==='before-pin'?0:1)}
});
test('attacker refuses supports and ingested records; witness-only findings pass',async t=>{
 for(const variant of ['supports','ingested','witnessed']){const s=setup(t,{mode:'attacker'});await s.pin();const result=s.call('record',{workspace:s.job.workspace,memo:s.memo,from_fact:'F1',claim:'C1',verdict:variant==='supports'?'supports':'refutes',...(variant==='ingested'?{input:{claim:'C1'}}:{})});if(variant==='witnessed')await result;else await assert.rejects(result);assert.equal(s.calls.length,variant==='witnessed'?2:1)}
});
test('a rejected resource read latches failure and prevents later writes',async t=>{const s=setup(t);await assert.rejects(s.gate.request('resources/read',{uri:'EXAMPLE'}));await assert.rejects(s.call('fact',{workspace:s.job.workspace,note:'EXAMPLE'}),/already failed/);assert.equal(s.calls.length,0)});
test('memo inside source is refused at construction',t=>{const s=setup(t);assert.throws(()=>createBoundGate(catalog,async()=>({}),{...s.job,memo:path.join(s.repo,'memo.md')},()=>{}),/outside the source/)});
test('missing-path look returns an audited tool error, then look and record succeed',async t=>{
 for(const mode of ['grounder','attacker']){
  const refusal={isError:true,content:[{type:'text',text:'ENOENT: no such file or directory'}]};
  const s=setup(t,{mode,respond:p=>p.name==='look'&&!fs.existsSync(p.arguments.path)?refusal:undefined});await s.pin();
  assert.equal(await s.call('look',{workspace:s.job.workspace,path:path.join(s.repo,'missing','file.txt')}),refusal);
  assert.equal(s.audit.filter(e=>e.kind==='result'&&e.result===refusal).length,1);
  assert.equal((await s.call('look',{workspace:s.job.workspace,path:path.join(s.repo,'example.txt')})).isError,undefined);
  await s.call('record',{workspace:s.job.workspace,memo:s.memo,from_fact:'F1',claim:'C1',verdict:mode==='attacker'?'refutes':'supports'});
  assert.deepEqual(s.calls.map(p=>p.name),['run','look','look','record']);assert.equal(s.audit.some(e=>e.kind==='gate-error'),false);
 }
});
test('ordinary look and allowlisted run refusals preserve their tool error and permit recovery',async t=>{
 for(const name of ['look','run']){
  const command=['EXAMPLE-program'],refusal={isError:true,content:[{type:'text',text:'EXAMPLE read refused'}]};let refused=false;
  const s=setup(t,{allowedCommands:[command],respond:p=>{if(!refused&&p.name===name&&(name!=='run'||p.arguments.command[0]!=='git')){refused=true;return refusal}}});await s.pin();
  assert.equal(await s.call(name,{workspace:s.job.workspace,...(name==='look'?{path:path.join(s.repo,'example.txt')}:{command})}),refusal);
  await s.call('look',{workspace:s.job.workspace,path:path.join(s.repo,'example.txt')});assert.equal(s.audit.filter(e=>e.kind==='result'&&e.result===refusal).length,1);
 }
});
test('pin mismatch, malformed pin, pin refusal and transport failures still latch',async t=>{
 for(const variant of ['mismatch','malformed','refused','transport']){
  const s=setup(t,{respond:()=>{if(variant==='transport')throw Error('EXAMPLE transport failure');return variant==='refused'?{isError:true,content:[]}:variant==='malformed'?{content:[{type:'text',text:'not JSON'}]}:{structuredContent:{exit_code:0,output:'b'.repeat(40)}}}});
  await assert.rejects(s.pin(),/pin mismatch|not structured|Tetel refused|transport failure/);
  await assert.rejects(s.call('look',{workspace:s.job.workspace,path:path.join(s.repo,'example.txt')}),/already failed/);assert.equal(s.calls.length,1);
 }
});
test('refused record latches and prevents subsequent reads and records',async t=>{
 const s=setup(t,{respond:p=>p.name==='record'?{isError:true,content:[{type:'text',text:'EXAMPLE record refused'}]}:undefined});await s.pin();
 const args={workspace:s.job.workspace,memo:s.memo,from_fact:'F1',claim:'C1',verdict:'supports'};
 await assert.rejects(s.call('record',args),/Tetel refused record/);
 await assert.rejects(s.call('look',{workspace:s.job.workspace,path:path.join(s.repo,'example.txt')}),/already failed/);
 await assert.rejects(s.call('record',args),/already failed/);assert.equal(s.calls.length,2);
});
test('out-of-scope missing paths stay unreadable without latching; unresolved links remain fatal',async t=>{
 for(const variant of ['outside','external-link','dangling-link']){
  const s=setup(t);let target=path.join(s.base,'missing','file.txt');
  if(variant!=='outside'){const link=path.join(s.repo,'link');fs.symlinkSync(variant==='external-link'?s.base:path.join(s.base,'absent'),link,process.platform==='win32'?'junction':'dir');target=path.join(link,'missing','file.txt')}
  await s.pin();const read=s.call('look',{workspace:s.job.workspace,path:target});
  if(variant==='dangling-link'){
   await assert.rejects(read);await assert.rejects(s.call('look',{workspace:s.job.workspace,path:path.join(s.repo,'example.txt')}),/already failed/);assert.equal(s.calls.length,1);
  }else{
   const refusal=await read;assert.equal(refusal.isError,true);assert.equal(refusal.structuredContent.path,target);assert.equal(s.calls.length,1);
   await s.call('look',{workspace:s.job.workspace,path:path.join(s.repo,'example.txt')});assert.equal(s.calls.length,2);
  }
 }
});

test('out-of-scope native probe read is audited and allows subsequent look, fact and record',async t=>{
 for(const mode of ['grounder','attacker']){
  const s=setup(t,{mode}),target=path.join(s.base,'native-probes','RESULT.md');fs.mkdirSync(path.dirname(target));fs.writeFileSync(target,'EXAMPLE FORBIDDEN BYTES');await s.pin();
  const denied=await s.call('look',{workspace:s.job.workspace,path:target,lines:{start:1,end:45}});
  assert.equal(denied.isError,true);assert.equal(denied.structuredContent.code,'READ_SCOPE_DENIED');assert.equal(denied.structuredContent.number,1);assert.equal(denied.structuredContent.path,target);
  assert.doesNotMatch(JSON.stringify(denied),/FORBIDDEN BYTES/);assert.equal(s.calls.length,1);
  await s.call('look',{workspace:s.job.workspace,path:path.join(s.repo,'example.txt')});
  await s.call('fact',{workspace:s.job.workspace,note:'EXAMPLE permitted source'});
  await s.call('record',{workspace:s.job.workspace,memo:s.memo,claim:'C1',from_fact:'F1',verdict:'qualifies',note:'EXAMPLE native evidence unavailable'});
  assert.deepEqual(s.calls.map(p=>p.name),['run','look','fact','record']);
  assert.deepEqual(summarizeGateAudit(s.audit),{rejected:[],deniedReadCount:1,deniedReadPaths:[target]});
  const event=s.audit.find(e=>e.kind==='read-denied');assert.equal(event.number,1);assert.equal(event.path,target);
 }
});
test('denial count and paths survive a later fatal pin mismatch',async t=>{
 let changed=false;const s=setup(t,{respond:p=>changed&&p.name==='run'?{structuredContent:{exit_code:0,output:'b'.repeat(40)}}:undefined});await s.pin();
 const paths=[s.memo,path.join(s.base,'missing','outside.md')];
 for(const [i,target] of paths.entries())assert.equal((await s.call('look',{workspace:s.job.workspace,path:target})).structuredContent.number,i+1);
 changed=true;await assert.rejects(s.pin(),/pin mismatch/);await assert.rejects(s.call('fact',{workspace:s.job.workspace,note:'EXAMPLE'}),/already failed/);
 const summary=summarizeGateAudit(s.audit);assert.equal(summary.deniedReadCount,2);assert.deepEqual(summary.deniedReadPaths,paths);assert.ok(summary.rejected.length>0);
});
test('an upstream error with scope-denial wording is still fatal',async t=>{
 const s=setup(t,{respond:p=>{if(p.name==='look')throw Error('Read outside the assigned source or permitted memo artifacts')}});await s.pin();
 await assert.rejects(s.call('look',{workspace:s.job.workspace,path:path.join(s.repo,'example.txt')}),/outside/);
 await assert.rejects(s.call('fact',{workspace:s.job.workspace,note:'EXAMPLE'}),/already failed/);assert.equal(summarizeGateAudit(s.audit).deniedReadCount,0);
});
test('both roles receive exact allowed paths and the native-probe exclusion',t=>{
 for(const mode of ['grounder','attacker']){
  const s=setup(t,{mode}),text=readScopeInstructions(s.job);assert.ok(text.includes(JSON.stringify(fs.realpathSync(s.repo))));assert.ok(text.includes(JSON.stringify(s.memo)));assert.match(text,/native-probes.*NOT readable/);assert.match(text,/citation is not permission/);
  if(mode==='attacker')assert.ok(text.includes(JSON.stringify(s.memo+'.tetel')));else assert.match(text,/grounder cannot read the memo or snapshot/);
 }
});
function checkReport(kind){return {isError:!!kind,content:[{type:'text',text:
 `machine-checked: ${kind?'1 failing ('+kind+' 1)':'clean'} — grammar, claims out of proof\n`+
 (kind?`  - [${kind}] C1: EXAMPLE revised claim needs evidence\n`:'')+
 '\nhuman-owed: every READING/OBSERVED/ATTESTED row — none of this is settled by a passing check\n\nchecked by tetel EXAMPLE test build\n'}]}}
test('attacker checks are audited data even when out-of-proof or ungrounded; a complete pass is possible',async t=>{
 for(const kind of [undefined,'out-of-proof','ungrounded']){
  const report=checkReport(kind),s=setup(t,{mode:'attacker',respond:p=>p.name==='check'?report:p.name==='look'?{content:[{type:'text',text:'EXAMPLE MEMO\n'}]}:undefined});
  await s.pin();assert.equal(await s.call('check',{file:s.memo}),report);
  const deniedPath=path.join(s.base,'native-probes','RESULT.md');
  assert.equal((await s.call('look',{workspace:s.job.workspace,path:deniedPath})).isError,true);
  await s.call('look',{workspace:s.job.workspace,path:s.memo});
  assert.equal(s.audit.filter(e=>e.kind==='result'&&e.name==='check'&&e.result===report).length,1);
  assert.equal(s.audit.some(e=>e.kind==='gate-error'||e.kind==='denied'),false);
  const brief={floor:1,claims:[{id:'C1',proposition:'EXAMPLE'}],owed:['C1']};
  const summary=summarizeGateAudit(s.audit);assert.equal(summary.deniedReadCount,1);assert.deepEqual(summary.deniedReadPaths,[deniedPath]);
  const result=assessAttack({before:brief,after:brief,turnStatus:'completed',initialDigest:'EXAMPLE',finalDigest:'EXAMPLE',initialLedger:Buffer.alloc(0),finalLedger:Buffer.alloc(0),recordReceipts:[],gateErrors:summary.rejected,audit:s.audit,memo:s.memo,memoText:'EXAMPLE MEMO\n',report:{targets:['EXAMPLE decision'],findings:[],missingClaims:[],worthwhile:{answer:'yes',reason:'EXAMPLE current decision examined'},routed:[],unresolved:[]}});
  assert.deepEqual(result.reasons,[]);assert.equal(result.attackComplete,true);assert.equal(result.designApproved,false);
 }
});
test('check transport failures and tool refusals still latch',async t=>{
 for(const transport of [true,false]){
  const s=setup(t,{mode:'attacker',respond:p=>{if(p.name==='check'){if(transport)throw Error('EXAMPLE transport failure');return {isError:true,content:[{type:'text',text:'error reading memo: EXAMPLE failure'}]}}}});
  await s.pin();await assert.rejects(s.call('check',{file:s.memo}),/transport failure|machine-check report/);
  await assert.rejects(s.call('look',{workspace:s.job.workspace,path:s.memo}),/already failed/);
  assert.equal(s.calls.length,2);assert.ok(s.audit.some(e=>e.kind==='gate-error'));
 }
});
test('malformed check output latches with either isError value',async t=>{
 for(const isError of [true,false])for(const content of [[],[{type:'text',text:'EXAMPLE not a report'}],[{type:'text',text:'machine-checked: 1 failing (out-of-proof 1)'}],[{type:'text',text:42}],[{type:'text',text:checkReport('out-of-proof').content[0].text.replace(/^  - .*\n/m,'')}],[{type:'image',data:'EXAMPLE'}],[{type:'text',text:checkReport('out-of-proof').content[0].text.replace('1 failing','2 failing')}],[{type:'text',text:checkReport().content[0].text.replace('human-owed:','missing-partition:')}],[{type:'text',text:checkReport().content[0].text.replace('checked by tetel EXAMPLE test build','')}]] ){
  const s=setup(t,{mode:'attacker',respond:p=>p.name==='check'?{isError,content}:undefined});
  await assert.rejects(s.call('check',{file:s.memo}),/machine-check report/);
  await assert.rejects(s.call('check',{file:s.memo}),/already failed/);assert.equal(s.calls.length,1);
 }
});
test('check on a different memo latches before any upstream call',async t=>{
 const s=setup(t,{mode:'attacker',respond:()=>checkReport('out-of-proof')});
 await assert.rejects(s.call('check',{file:path.join(s.base,'other.md')}),/assigned memo/);
 await assert.rejects(s.call('check',{file:s.memo}),/already failed/);assert.equal(s.calls.length,0);
});
