'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {rpc}=require('./rpc-client.cjs');
const {readAccountUsage}=require('./account-usage.cjs');
const {inspectUsage,createBudget,checkBudget}=require('./queue-budget.cjs');
const {readCheckpoint,claimCheckpoint,plainPath}=require('./queue-checkpoint.cjs');
const {createOperator,validateAvailability}=require('./operator.cjs');
const {summarize,validatePrices}=require('./usage-report.cjs');
async function countdown(ms,signal){if(signal?.aborted)return false;return new Promise(resolve=>{let timer;const done=value=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);resolve(value)},cancel=()=>done(false);signal?.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>done(true),ms)})}
async function nativeSession(descriptor,options){
 const events=[],requests=[],decisions=[];let threadId,turnId,finish,timer,abortListener,turnFinished=false;
 const sessionAbort=new AbortController();
 const eventFile=path.join(path.dirname(descriptor.file),'events.jsonl');fs.writeFileSync(eventFile,'',{flag:'wx',mode:0o600});
 const operator=createOperator({ask:options.ask,availability:options.availability,timeoutMs:options.operatorTimeoutMs,signal:sessionAbort.signal,onDecision:decision=>{decisions.push(decision);fs.writeFileSync(descriptor.decisionsFile,JSON.stringify(decisions,null,2)+'\n')}});
 const args=['app-server','--stdio','-c','mcp_servers.lonic_queue.command='+JSON.stringify(process.execPath),'-c','mcp_servers.lonic_queue.args='+JSON.stringify([path.join(__dirname,'queue-server.cjs'),descriptor.file]),'-c','mcp_servers.lonic_queue.required=true','-c','mcp_servers.lonic_queue.tools.context.approval_mode="approve"','-c','mcp_servers.lonic_queue.tools.cost_log.approval_mode="approve"','-c','mcp_servers.lonic_queue.tools.handoff.approval_mode="approve"'];
 for(const [key,value]of Object.entries(options.providerOverrides||{})){if(key!=='model_provider'&&!key.startsWith('model_providers.'))throw Error('Only provider overrides are accepted');args.push('-c',key+'='+JSON.stringify(value))}
 const client=rpc(descriptor.codex,args,{cwd:descriptor.project,onRequest:async request=>{const record={method:request.method,params:request.params,resolved:false};requests.push(record);const result=await operator(request);record.resolved=true;return result},onMessage:event=>{
  events.push(event);fs.appendFileSync(eventFile,JSON.stringify(event)+'\n');
  if(event.method==='thread/tokenUsage/updated'){const report=summarize(events,{model:options.model,prices:options.prices,mainThreadId:threadId});const temp=descriptor.usageFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(report)+'\n');fs.renameSync(temp,descriptor.usageFile)}
  if(event.method==='item/completed'&&event.params.item.type==='agentMessage')console.log(JSON.stringify({step:descriptor.step,message:event.params.item.text}));
  if(event.method==='turn/completed'&&event.params.threadId===threadId){turnFinished=true;finish?.(event.params.turn)}
 }});
 try{
  await client.call('initialize',{clientInfo:{name:'lonic-queue-controller',version:'2'},capabilities:{experimentalApi:true}});client.notify('initialized');
  const entryFile=plainPath(options.entrySkillFile||require('./resolve-installation.cjs').skill(descriptor.project,descriptor.entrySkill));
  if(!fs.statSync(entryFile).isFile())throw Error('Queue entry skill is missing: '+entryFile);
  if(options.entrySkillFile)await client.call('skills/extraRoots/set',{extraRoots:[path.dirname(path.dirname(entryFile))]});
  const listed=await client.call('skills/list',{cwds:[descriptor.project],forceReload:true});if(!listed.data.flatMap(row=>row.skills||[]).some(skill=>path.resolve(skill.path)===entryFile&&skill.enabled))throw Error('The project entry skill is not available and enabled');
  const dynamicTools=[{type:'function',name:'lonic_ask',description:'Ask the attached operator a question. Outside availability, or without a reply, park it. A text reply does not bypass native permission checks.',inputSchema:{type:'object',properties:{question:{type:'string'}},required:['question'],additionalProperties:false}}];
  const policy=options.ask?'on-request':'never';
  const instruction='This is one session of an authorized lonic workflow. Preserve exact authority and exclusions. Use lonic_ask for decisions and native approval requests for permissions. Unanswered or declined requests are not permission. Park their exact questions; continue only independent authorized work. Do not retry declined actions without new explicit user authorization. Use lonic_queue context before costly work and handoff as your last tool call, then end the turn. The host alone starts a fresh session. One item or completed phase per session.';
  const thread=await client.call('thread/start',{cwd:descriptor.project,ephemeral:false,model:options.model,approvalPolicy:policy,approvalsReviewer:'user',sandbox:'workspace-write',dynamicTools,developerInstructions:instruction});threadId=thread.thread.id;
  const single=descriptor.entrySkill==='powerup';
  const prompt='$'+descriptor.entrySkill+'\n'+(single?'Work only on the assigned item; never select another queue item. Assigned item ID: '+descriptor.itemId+'\nTask locator: ':'Run one queue item or its next bounded phase. Queue locator: ')+descriptor.queue+'\nAuthority: '+descriptor.authority+'\nStanding exclusions: '+JSON.stringify(descriptor.exclusions)+'\nUse lonic_queue context for measured usage. Operator availability: '+JSON.stringify(options.availability||null)+'; attached operator: '+Boolean(options.ask)+'. Park unanswered decisions.\n'+(options.resumePrompt?'Previous checkpoint is context, not new authorization. Re-read source before acting.\n'+options.resumePrompt:'Read the assigned work freshly.')+'\nAt the boundary call lonic_queue handoff with status continue, stop or done. Use done only when the assigned work is complete. Include a standalone resumePrompt beginning with $'+descriptor.entrySkill+', actual checked source state including untracked files, checks, findings, and next actions. Even done/stop needs a final-report or recovery next action. No commit or publication merely to save a checkpoint.';
  const done=new Promise((resolve,reject)=>{finish=resolve;timer=setTimeout(()=>reject(Error('Workflow session timed out')),options.timeoutMs);abortListener=()=>reject(Error('Workflow cancelled by the operator'));options.signal?.addEventListener('abort',abortListener,{once:true})});
  // Attach a handler before awaiting turn/start, which can itself take time.
  done.catch(()=>{});if(options.signal?.aborted)throw Error('Workflow cancelled before turn start');
  turnId=(await client.call('turn/start',{threadId,input:[{type:'text',text:prompt},{type:'skill',name:descriptor.entrySkill,path:entryFile}]})).turn.id;
  console.log(JSON.stringify({step:descriptor.step,threadId}));const turn=await done;return {threadId,entrySkillFile:entryFile,turnStatus:turn.status,interactiveRequests:requests,operatorDecisions:decisions};
 }catch(error){sessionAbort.abort();if(threadId&&turnId&&!turnFinished){try{await client.call('turn/interrupt',{threadId,turnId},3000);await new Promise(resolve=>{const until=setTimeout(resolve,3000);finish=()=>{clearTimeout(until);resolve()};if(turnFinished){clearTimeout(until);resolve()}})}catch{}}return {threadId,turnStatus:'failed',terminationObserved:turnFinished,error:error.message,interactiveRequests:requests,operatorDecisions:decisions}}
 finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abortListener);sessionAbort.abort();client.close()}
}
async function runQueue(options,adapters={}){
 if(options.managed===true)return require('./managed-controller.cjs').runManagedQueue(options,adapters.managed);
 const readUsage=adapters.readUsage||readAccountUsage,runSession=adapters.runSession||nativeSession;
 for(const field of ['codex','model','project','queue','authority'])if(typeof options[field]!=='string'||!options[field].trim())throw Error('Missing queue run parameter: '+field);
 if(!['queue-run','powerup-auto','powerup'].includes(options.entrySkill))throw Error('Choose queue-run, powerup-auto or powerup');
 validateAvailability(options.availability);validatePrices(options.prices);
 if(options.availability&&!options.ask)throw Error('Availability requires an attached operator');
 const delay=options.handoffDelayMs??20000;if(!Number.isInteger(delay)||delay<0||delay>60000)throw Error('Invalid handoff delay');
 if(!Array.isArray(options.exclusions)||options.exclusions.some(s=>typeof s!=='string'))throw Error('Record explicit standing exclusions, or an empty list');
 const project=fs.realpathSync(plainPath(options.project)),maxSteps=options.maxSteps??20,timeoutMs=options.timeoutMs??7200000;
 if(!fs.statSync(project).isDirectory()||!Number.isInteger(maxSteps)||maxSteps<1||maxSteps>1000||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>43200000)throw Error('Invalid project or run bound');
 if((options.absolute===undefined)===(options.relative===undefined))throw Error('An explicit current-run absolute or relative threshold is required');
 const initial=await readUsage(options.codex,project),reading=inspectUsage(initial.response,{bucket:options.bucket,observedAt:initial.observedAt});
 if(!reading.allowed)return {status:'stopped',reason:reading.reason,sessions:[]};
 const runId=crypto.randomUUID(),budget=createBudget(reading,{runId,absolute:options.absolute,relative:options.relative});
 const parent=plainPath(options.runRoot||path.join(os.tmpdir(),'lonic-codex-queues'));fs.mkdirSync(parent,{recursive:true});plainPath(parent);
 const lockRoot=plainPath(path.join(os.tmpdir(),'lonic-codex-queue-locks'));fs.mkdirSync(lockRoot,{recursive:true});plainPath(lockRoot);
 const lock=path.join(lockRoot,crypto.createHash('sha256').update((process.platform==='win32'?project.toLowerCase():project) ).digest('hex')+'.lock');
 const lockBytes=JSON.stringify({runId,pid:process.pid,project,queue:options.queue});fs.writeFileSync(lock,lockBytes,{flag:'wx',mode:0o600});
 let root,report;try{
  root=fs.mkdtempSync(path.join(parent,'run-'));const budgetFile=path.join(root,'budget.json'),checkpoints=path.join(root,'checkpoints');fs.writeFileSync(budgetFile,JSON.stringify(budget)+'\n',{flag:'wx',mode:0o600});
  report={runId,root,status:'running',sessions:[],reason:null};let resumePrompt,operatorHistory=[];
  for(let step=1;step<=maxSteps;step++){
   if(options.signal?.aborted){report.status='stopped';report.reason='operator-cancelled';break}
    const snapshot=await readUsage(options.codex,project);const current=checkBudget(JSON.parse(fs.readFileSync(budgetFile,'utf8')),snapshot.response,{observedAt:snapshot.observedAt});if(current.budget!==undefined)fs.writeFileSync(budgetFile,JSON.stringify(current.budget)+'\n');
   if(!current.allowed){report.status='stopped';report.reason=current.reason;break}
   const stepRoot=path.join(root,'step-'+step);fs.mkdirSync(stepRoot);const descriptor={file:path.join(stepRoot,'descriptor.json'),runId,step,codex:options.codex,project,queue:options.queue,entrySkill:options.entrySkill,availability:options.availability||null,priorOperatorDecisions:operatorHistory,itemId:options.entrySkill==='powerup'?(options.itemId||options.queue):undefined,authority:options.authority,exclusions:options.exclusions,budgetFile,checkpoints,usageFile:path.join(stepRoot,'usage.json'),decisionsFile:path.join(stepRoot,'operator-decisions.json'),handoffFile:path.join(stepRoot,'handoff.json')};fs.writeFileSync(descriptor.file,JSON.stringify(descriptor,null,2)+'\n');
   const session=await runSession(descriptor,{model:options.model,timeoutMs,resumePrompt,ask:options.ask,availability:options.availability,operatorTimeoutMs:options.operatorTimeoutMs,signal:options.signal,prices:options.prices});report.sessions.push({step,...session});
   if(session.turnStatus!=='completed'||session.interactiveRequests?.some(request=>request.resolved!==true)){report.status='needs-reconciliation';report.reason='Session failed, was interrupted, or needed user input';break}
   if(!fs.existsSync(descriptor.handoffFile)){report.status='needs-reconciliation';report.reason='Session ended without a saved handoff';break}
   const saved=JSON.parse(fs.readFileSync(descriptor.handoffFile,'utf8'));if(path.dirname(path.resolve(saved.file))!==path.resolve(checkpoints))throw Error('Checkpoint pointer escapes this run');
   const checkpoint=readCheckpoint(saved.file);if(descriptor.itemId&&checkpoint.data.itemId!==descriptor.itemId)throw Error('Bare powerup changed its assigned item');if(checkpoint.sha256!==saved.sha256||checkpoint.data.runId!==runId||checkpoint.data.authority!==options.authority||checkpoint.data.entrySkill!==options.entrySkill||checkpoint.data.queue!==options.queue||JSON.stringify(checkpoint.data.exclusions)!==JSON.stringify(options.exclusions))throw Error('Checkpoint identity or authority mismatch');
   operatorHistory=checkpoint.data.operatorDecisions||[];
   report.sessions.at(-1).checkpoint=saved.file;
   if(checkpoint.data.status==='done'){report.status='complete';report.reason=checkpoint.data.reason;break}
   if(checkpoint.data.status!=='continue'){report.status='stopped';report.reason=checkpoint.data.reason;break}
   if(step===maxSteps){report.status='step-limit';report.reason='Reached the explicit controller step bound';break}
   console.log(JSON.stringify({handoffInMs:delay,instruction:'Press Ctrl+C to cancel continuation',checkpoint:saved.file}));
   if(!await (adapters.countdown||countdown)(delay,options.signal)){report.status='stopped';report.reason='handoff-cancelled';break}
   claimCheckpoint(saved.file,saved.sha256,'queue-controller:'+runId+':step-'+(step+1));resumePrompt=JSON.stringify({checkpointFile:saved.file,sha256:saved.sha256,data:checkpoint.data});
  }
  return report;
 }catch(error){if(report){report.status='needs-reconciliation';report.reason=error.message;return report}throw error}
 finally{if(root&&report)fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2)+'\n');try{if(fs.readFileSync(lock,'utf8')===lockBytes)fs.unlinkSync(lock)}catch{}}
}
module.exports={runQueue,nativeSession,countdown};
