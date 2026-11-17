'use strict';
const fs=require('node:fs'),path=require('node:path');const {rpc}=require('./rpc-client.cjs');
const {parseBrief,artifactDigest,ledgerBytes,assessGrounding}=require('./grounding-result.cjs');
const {TOOL_SETS,summarizeGateAudit,readScopeInstructions}=require('./bound-grounder-gate.cjs');
const {assessAttack}=require('./attack-result.cjs');
const {execFileSync}=require('node:child_process');
function toml(value){if(Array.isArray(value))return '['+value.map(toml).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).map(([k,v])=>JSON.stringify(k)+'='+toml(v)).join(',')+'}';return JSON.stringify(value)}
function readAudit(file){return fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)):[]}
async function runGrounder(job,options={}) {
 const mode=job.mode||'grounder';if(!TOOL_SETS[mode])throw Error('Unknown evidence mode');
 const ALLOWED=[...TOOL_SETS[mode]].sort();
 for(const file of [job.audit,job.events,job.result])if(fs.existsSync(file))throw Error('Evidence output already exists; create a fresh pass instead of replaying an audit');
 let finalText='';
 const work=job.workDir;fs.mkdirSync(work,{recursive:true});
 const env=options.codeHome?{CODEX_HOME:options.codeHome,OPENAI_API_KEY:'',CODEX_API_KEY:''}:{};
 const boot=rpc(job.codex,['app-server','--stdio','-c','features.apps=false','-c','features.plugins=false','-c','features.hooks=false'],{cwd:work,env});
 let serverNames=[],skills=[];
 try{
  await boot.call('initialize',{clientInfo:{name:'grounder-preflight',version:'1'},capabilities:{experimentalApi:true}});boot.notify('initialized');
  const [config,list]=await Promise.all([boot.call('config/read',{cwd:work,includeLayers:false}),boot.call('skills/list',{cwds:[work],forceReload:true})]);
  serverNames=Object.keys(config.config.mcp_servers||{});skills=[...new Set(list.data.flatMap(row=>(row.skills||[]).map(s=>s.path)))];
 }finally{boot.close()}
 const config={
  model:job.model,model_reasoning_effort:'medium',project_doc_max_bytes:0,notify:[],
  'features.shell_tool':false,'features.view_image':false,'features.image_generation':false,'agents.enabled':false,
  'features.multi_agent':false,'features.apps':false,'features.plugins':false,'features.memories':false,'features.hooks':false,
  'features.request_permissions_tool':false,'features.browser_use':false,'features.computer_use':false,'features.skill_search':false,
  'features.goals':false,'features.sleep_tool':false,'features.workspace_dependencies':false,
  'skills.bundled.enabled':false,'skills.include_instructions':false,'skills.config':skills.map(p=>({path:p,enabled:false})),web_search:'disabled'
 };
 for(const name of serverNames){if(!/^[a-zA-Z0-9_-]+$/.test(name))throw Error('Unsupported inherited MCP key; refusing startup');config['mcp_servers.'+name+'.enabled']=false}
 Object.assign(config,options.provider||{});
 config['mcp_servers.grounder.command']=process.execPath;
 config['mcp_servers.grounder.args']=[path.join(__dirname,'grounder-gate-server.cjs'),job.jobPath];
 config['mcp_servers.grounder.enabled']=true;config['mcp_servers.grounder.required']=true;
 config['mcp_servers.grounder.enabled_tools']=ALLOWED;
 for(const name of ALLOWED)config['mcp_servers.grounder.tools.'+name+'.approval_mode']='approve';
 const args=['app-server','--stdio'];for(const[k,v]of Object.entries(config))args.push('-c',k+'='+toml(v));
 let active,activeTurn,finish,interruptFinished,evidence;const events=[];
 const c=rpc(job.codex,args,{cwd:work,env,onStderr:s=>fs.appendFileSync(job.events+'.stderr.log',s),onMessage:e=>{
  events.push(e);fs.appendFileSync(job.events,JSON.stringify(e)+'\n');
  if(e.method==='item/completed'&&e.params.item.type==='agentMessage'){finalText=e.params.item.text;console.log(JSON.stringify({[mode]:finalText}));}
  if(e.method==='turn/completed'&&e.params.threadId===active){if(finish)finish(e.params.turn);if(interruptFinished)interruptFinished(e.params.turn);}
 }});
 try{
  await c.call('initialize',{clientInfo:{name:'isolated-lonic-grounder-prototype',version:'1'},capabilities:{experimentalApi:true}});c.notify('initialized');
  const [inventory,skillList]=await Promise.all([c.call('mcpServerStatus/list',{}),c.call('skills/list',{cwds:[work],forceReload:true})]);
  const servers=inventory.data.filter(s=>Object.keys(s.tools||{}).length);
  if(servers.length!==1||servers[0].name!=='grounder'||JSON.stringify(Object.keys(servers[0].tools).sort())!==JSON.stringify(ALLOWED))throw Error('Unexpected MCP surface; refusing model turn');
  const enabled=skillList.data.flatMap(r=>r.skills||[]).filter(s=>s.enabled);if(enabled.length)throw Error('Unexpected enabled skills; refusing model turn');
  evidence=rpc(job.tetel,['mcp'],{cwd:job.repo,env:job.tetelEnv});
  await evidence.call('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'grounding-completion-check',version:'1'}});evidence.notify('notifications/initialized');
  const initialDigest=artifactDigest(job.memo),initialLedger=ledgerBytes(job.memo),memoText=mode==='attacker'?fs.readFileSync(job.memo,'utf8'):null;
  const before=parseBrief(await evidence.call('tools/call',{name:'brief',arguments:{memo:job.memo,json:true}}));
  const original=fs.readFileSync(job.policy||path.join(__dirname,'policies',mode==='attacker'?'lonic-design-attacker.md':'lonic-grounder.md'),'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'').replace(/mcp__tetel__/g,'mcp__grounder__');
  const t=await c.call('thread/start',{cwd:work,ephemeral:true,approvalPolicy:'never',sandbox:'read-only',model:job.model,baseInstructions:'You are an independent evidence '+mode+'. Follow the supplied policy. Use the grounder MCP gateway for captured evidence. Do not author code or start agents.',developerInstructions:original+'\n\n'+readScopeInstructions(job)+'\n\nCodex adapter: the run capability permits only the exact pin command and the predeclared commands supplied as task metadata. Do not invent another command or use a framework helper as a source-reading channel. Native Codex helpers may remain visible; exact seven-tool parity is not claimed. Do not request user input, change settings, or start agents. Query only your own workspace. For an attack, derive the citation closure from the rendered memo; do not query the author workspace for dependencies. Use separate bounded look calls for memo ranges; do not combine a long memo into one tool reply.',experimentalRawEvents:true});active=t.thread.id;
  if(!Array.isArray(t.instructionSources)||t.instructionSources.length)throw Error('Unexpected instruction sources; refusing model turn. Review the reported sources before retrying. Existing login may be retained.');
  const metadata=(job.attackBaseline?'Initial attack pair: check returns the shared pre-pair check, not a fresh closure check. Peer findings are withheld. Record against the actual memo normally. The host checks the current ledger after each pass. ':'')+'Assigned memo: '+job.memo+'. Source repository: '+job.repo+'. Expected Git commit: '+job.pin+'. Your unique workspace: '+job.workspace+'. Run the pin check first with command '+JSON.stringify(['git','-C',fs.realpathSync(job.repo),'rev-parse','HEAD'])+'. Other predeclared run commands: '+JSON.stringify(job.allowedCommands||[])+'. No other commands are available. Capture all source reads with look/run. Respond in English.';
  const prompt=options.prompt||(mode==='grounder'
   ? metadata+' Ground the memo using your own brief call. Do not read the memo, snapshot, ledger, planning folder, or author workspace. Get every proposition and its owed subset from brief. Mint your own facts and record with from_fact. Report verdicts without claiming all claims are true.'
   : metadata+' Attack the current decision following the supplied policy. Read the complete memo through ranged look calls. Memo line count: '+memoText.split(/\r?\n/).filter((_,i,a)=>i<a.length-1||a[i]!=='').length+'. Read each range in a separate tool call with no more than 50 lines; use smaller ranges for long lines. Run check. Record witnessed refutes/qualifies only. Return ONLY one JSON object in your final message: {"targets":["decision-cone target"],"findings":[{"claim":"C1","verdict":"refutes","fact":"F1","changesBuild":true,"explanation":"concrete effect"}],"missingClaims":[{"decision":"exact decision sentence","neededProposition":"missing premise","facts":["F1"],"changesBuild":true}],"worthwhile":{"answer":"yes or no","reason":"does the bottom line answer the question and justify its cost"},"routed":[],"unresolved":[]}. The sample entries illustrate the schema, not expected findings. Empty findings arrays are valid. Every fact ID must be one you minted in this pass. Do not wrap the object in Markdown.');
  let timer;const done=new Promise((resolve,reject)=>{finish=resolve;timer=setTimeout(()=>reject(Error(mode+' evidence pass timed out after '+(options.timeoutMs||240000)+' ms; review the saved partial result before changing timeoutMs or starting a separately authorized fresh pass')),options.timeoutMs||240000)});
  let turn;try{const started=await c.call('turn/start',{threadId:active,input:[{type:'text',text:prompt}]});activeTurn=started.turn.id;turn=await done;if(turn.status!=='completed')throw Error(JSON.stringify(turn));}finally{clearTimeout(timer)}
  const audit=readAudit(job.audit);
  const {rejected,deniedReadCount,deniedReadPaths}=summarizeGateAudit(audit);
  const after=parseBrief(await evidence.call('tools/call',{name:'brief',arguments:{memo:job.memo,json:true}}));
  const recordReceipts=[],pendingRecords=[];
  for(const entry of audit){if(entry.kind==='forward'&&entry.name==='record')pendingRecords.push(entry.arguments);if(entry.kind==='result'&&entry.name==='record'){const args=pendingRecords.shift();const value=entry.result.structuredContent||JSON.parse(entry.result.content.filter(x=>x.type==='text').map(x=>x.text).join('\n'));if(!args||args.workspace!==job.workspace||value.claim!==args.claim||value.from_fact!==args.from_fact)throw Error('Record receipt does not match the bound request');recordReceipts.push({...value,verdict:args.verdict})}}
  const inputs={before,after,turnStatus:turn.status,initialDigest,finalDigest:artifactDigest(job.memo),initialLedger,finalLedger:ledgerBytes(job.memo),recordReceipts,gateErrors:rejected};
  let report=null;if(mode==='attacker'){try{report=JSON.parse(finalText)}catch{}}
  const completion=mode==='attacker'?assessAttack({...inputs,audit,memo:job.memo,memoText,report}):assessGrounding(inputs);
  const finalPin=execFileSync('git',['-C',job.repo,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
  if(finalPin!==job.pin){completion.groundingComplete=false;completion.attackComplete=false;completion.status='invalidated';completion.reasons.push('Source HEAD changed during the pass')}
  const result={mode,completion,checkView:job.attackBaseline?'shared-pre-pair':'current',threadId:active,turnStatus:turn.status,completedWithoutGateError:rejected.length===0,rejected,deniedReadCount,deniedReadPaths,forwarded:audit.filter(e=>e.kind==='forward').map(e=>({name:e.name,arguments:e.arguments})),frameworkDeviation:'Native Codex helpers remain; exact seven-tool parity is not claimed.'};
  fs.writeFileSync(job.result,JSON.stringify(result,null,2)+'\n');return result;
 }catch(error){
    let interrupted=false;
  if(active&&activeTurn){let stopTimer;const stopped=new Promise(resolve=>{interruptFinished=turn=>resolve(turn.status==='interrupted');stopTimer=setTimeout(()=>resolve(false),2000)});try{await c.call('turn/interrupt',{threadId:active,turnId:activeTurn},1500);interrupted=await stopped}catch{}finally{clearTimeout(stopTimer)}}
  let auditSummary;try{auditSummary=summarizeGateAudit(readAudit(job.audit))}catch(auditError){auditSummary={deniedReadCount:null,deniedReadPaths:[],auditError:auditError.message}}
  fs.writeFileSync(job.result,JSON.stringify({threadId:active||null,turnStatus:'failed',completedWithoutGateError:false,interruptionObserved:interrupted,error:error.message,...auditSummary},null,2)+'\n');throw error;
 }finally{if(evidence)evidence.close();c.close()}
}
module.exports={runGrounder,runEvidence:runGrounder};
if(require.main===module){const job=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));runGrounder(job).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.stack);process.exitCode=1})}
