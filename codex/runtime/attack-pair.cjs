'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {rpc}=require('./rpc-client.cjs');
const {artifactDigest}=require('./grounding-result.cjs');
const {plainPath}=require('./queue-checkpoint.cjs');
async function runAttackPair(options,adapters={}){
 const create=adapters.createJob||require('./evidence.cjs').createJob;
 const run=adapters.runEvidence||require('./run-isolated-grounder.cjs').runEvidence;
 const first=create({...options,mode:'attacker'}),memo=first.job.memo;
 const lock=plainPath(memo+'.lonic-attack-pair.lock');const lockBytes=JSON.stringify({pair:crypto.randomUUID(),pid:process.pid});fs.writeFileSync(lock,lockBytes,{flag:'wx',mode:0o600});
 let client,report;const resultFile=path.join(path.dirname(first.job.jobPath),'pair-result.json');
 try{
  const digest=artifactDigest(memo);
  if(adapters.captureCheck)client={call:adapters.captureCheck,close(){}};
  else {client=rpc(first.job.tetel,['mcp'],{cwd:first.job.repo,env:first.job.tetelEnv});await client.call('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'lonic-attack-pair',version:'1'}});client.notify('notifications/initialized')}
  const baseline=await client.call('tools/call',{name:'check',arguments:{file:memo}});
  if(baseline.isError||artifactDigest(memo)!==digest)throw Error('Initial attack check failed or memo changed');
  report={pairComplete:false,designApproved:false,checkView:'shared-pre-pair',memo,digest,passes:[],resultFile};
  for(let index=0;index<2;index++){
   if(artifactDigest(memo)!==digest)throw Error('Memo changed between initial attacks');
   const current=index===0?first:create({...options,mode:'attacker'});
   if(current.job.pin!==first.job.pin||current.job.repo!==first.job.repo)throw Error('Source pin changed between initial attacks');
   current.job.attackBaseline={digest,result:baseline};
   fs.writeFileSync(current.job.jobPath,JSON.stringify(current.job,null,2)+'\n');
   const result=await run(current.job,{timeoutMs:current.timeoutMs});report.passes.push({job:current.job.jobPath,result:current.job.result,workspace:current.job.workspace,threadId:result.threadId,completion:result.completion});
   if(!result.completion.attackComplete)throw Error('Initial attack incomplete; preserve recorded findings and reconcile before retrying');
  }
  if(artifactDigest(memo)!==digest)throw Error('Memo changed during the initial pair');
  report.currentCheck=await client.call('tools/call',{name:'check',arguments:{file:memo}});
  if(report.currentCheck.isError)throw Error('Current post-pair check failed');
  report.pairComplete=true;return report;
 }catch(error){if(report){report.error=error.message;return report}throw error}
 finally{if(report)fs.writeFileSync(resultFile,JSON.stringify(report,null,2)+'\n');if(client)client.close();try{if(fs.readFileSync(lock,'utf8')===lockBytes)fs.unlinkSync(lock)}catch{}}
}
module.exports={runAttackPair};
