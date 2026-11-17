'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createGrounderGate}=require('./grounder-tool-gate.cjs');
const {artifactDigest}=require('./grounding-result.cjs');
const {isMachineCheckReport,BASELINE_CHECK_NOTICE}=require('./attack-result.cjs');
const TOOL_SETS={grounder:['brief','look','run','fact','record','query','workspaces'],attacker:['check','look','run','fact','record','query','workspaces']};
class ReadScopeError extends Error{}
function summarizeGateAudit(audit){
 const deniedReads=audit.filter(e=>e.kind==='read-denied');
 return {rejected:audit.filter(e=>['denied','gate-error','rejected-request'].includes(e.kind)),deniedReadCount:deniedReads.length,deniedReadPaths:deniedReads.map(e=>e.path)};
}
function readScopeInstructions(job){
 const repo=JSON.stringify(fs.realpathSync(job.repo)),memo=JSON.stringify(path.resolve(job.memo)),snapshot=JSON.stringify(path.resolve(job.memo)+'.tetel');
 return 'Bound read scope: after the exact pin check, look may read resolved paths under source root '+repo+'. '+
  (job.mode==='attacker'?'The attacker may additionally read exactly memo '+memo+' and files under snapshot '+snapshot+'. ':'The grounder cannot read the memo or snapshot; obtain propositions only through brief on '+memo+'. ')+
  'The rest of the planning directory, including native-probes, reports, scripts, diffs and evidence ledgers, is NOT readable. Neither are profiles, credentials or other workspaces. A citation is not permission to open its path. An out-of-scope look returns an audited tool error without ending the pass: report the unavailable evidence and continue only within scope; do not retry through another tool or infer support. Pin mismatch, integrity and other fatal gate errors still require a stop.';
}
function createBoundGate(catalog,upstream,job,audit){
 const mode=job.mode||'grounder';if(!TOOL_SETS[mode])throw Error('Unknown evidence mode');
 if(job.attackBaseline&&(mode!=='attacker'||job.attackBaseline.result?.isError||!job.attackBaseline.digest))throw Error('Invalid initial attack baseline');
 if(!/^[0-9a-f]{40}$/.test(job.pin))throw Error('A full Git commit pin is required');
 const root=fs.realpathSync(job.repo),memo=path.resolve(job.memo);
 const key=p=>process.platform==='win32'?p.toLowerCase():p;
 const equal=(a,b)=>key(a)===key(b);
 const inside=(base,p)=>{const rel=path.relative(base,p);return !rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel))};
 if(inside(root,memo))throw Error('Keep the memo and its planning artifacts outside the source repository');
 const pinCommand=['git','-C',root,'rev-parse','HEAD'];
 const allowedCommands=job.allowedCommands||[];
 if(!Array.isArray(allowedCommands)||allowedCommands.some(c=>!Array.isArray(c)||!c.length||c.some(s=>typeof s!=='string'||!s||s.includes('\0'))))throw Error('Invalid exact command allowlist');
 const isPin=command=>JSON.stringify(command)===JSON.stringify(pinCommand);
 const isListed=command=>allowedCommands.some(c=>JSON.stringify(c)===JSON.stringify(command));
 function readable(actual){return inside(root,actual)||(mode==='attacker'&&(equal(actual,memo)||inside(memo+'.tetel',actual)))}
 function inspectPath(target,recursive){
  let actual;
  try{actual=fs.realpathSync(target)}catch(error){
   if(error.code!=='ENOENT')throw error;
   // Validate the nearest existing ancestor before letting tetel report a missing path.
   // Unresolved links and other inspection errors remain integrity failures.
   let parent=target;
   for(;;){
    try{fs.lstatSync(parent);break}catch(e){if(e.code!=='ENOENT')throw e}
    const next=path.dirname(parent);if(next===parent)throw error;parent=next;
   }
   const resolved=fs.realpathSync(parent);
   if(!readable(resolved))throw new ReadScopeError('Read outside the assigned source or permitted memo artifacts');
   return;
  }
  if(!readable(actual))throw new ReadScopeError('Read outside the assigned source or permitted memo artifacts');
  let count=0;
  function inspect(file){if(++count>100000)throw Error('Recursive read exceeds the inspection bound; use a smaller subtree');const st=fs.lstatSync(file);
   if(st.isSymbolicLink())throw Error('Recursive read contains a symlink or junction; use explicit resolved file reads');
   if(st.isDirectory()){for(const name of fs.readdirSync(file))inspect(path.join(file,name))}
   else if(!st.isFile())throw Error('Recursive read contains a special file');
  }
  const st=fs.statSync(actual);if(!st.isFile()&&!st.isDirectory())throw Error('Only regular files and directories are readable');
  if(recursive&&st.isDirectory())inspect(actual);
  return actual;
 }
 let pinned=false,failed=false,deniedReadCount=0;
 const base=createGrounderGate(catalog,async(method,params)=>{
  const name=params.name,args=params.arguments;
  function deny(reason){failed=true;audit({kind:'denied',name,reason});throw Error(reason)}
  if(failed)return deny('Evidence run already failed; start a new run');
  if(['look','run','fact','query','record'].includes(name)&&args.workspace!==job.workspace)return deny('Workspace does not match this run');
  if(name==='brief'&&(args.authoring||!args.memo||!equal(path.resolve(args.memo),memo)))return deny('Brief is restricted to the assigned memo');
  if(name==='check'&&(!args.file||!equal(path.resolve(args.file),memo)))return deny('Check is restricted to the assigned memo');
  if(name==='look'){
   if(!pinned)return deny('Pinned source must be checked before reads');
   if(!path.isAbsolute(args.path))return deny('Source path must be absolute');
   try{inspectPath(args.path,typeof args.grep==='string')}catch(e){
    if(!(e instanceof ReadScopeError))return deny(e.message);
    const refusal={code:'READ_SCOPE_DENIED',number:++deniedReadCount,path:args.path,reason:e.message};
    audit({kind:'read-denied',name,...refusal});
    return {isError:true,structuredContent:refusal,content:[{type:'text',text:e.message+': '+args.path+'. Continue only within the declared read scope.'}]};
   }
  }
  if(name==='run'){
   if(!isPin(args.command)&&(!pinned||!isListed(args.command)))return deny('Run requires the pin command or an exact predeclared command after pin verification');
  }
  if(['fact','record','query'].includes(name)&&!pinned)return deny('Pinned source must be checked first');
  if(name==='record'&&(!args.memo||!equal(path.resolve(args.memo),memo)||!args.from_fact||args.input!=null))return deny('Record requires captured facts and the assigned memo');
  if(mode==='attacker'&&name==='record'&&!['refutes','qualifies'].includes(args.verdict))return deny('An attacker records refutes or qualifies, not supports');
  audit({kind:'forward',name,arguments:args});let result;
  if(name==='check'&&job.attackBaseline){
   if(artifactDigest(memo)!==job.attackBaseline.digest)return deny('Initial attack memo or snapshot changed');
   // Both initial passes observe the same pre-pair check. Records still append to
   // the real memo ledger. The host checks the current state after each pass.
   result=structuredClone(job.attackBaseline.result);
   result.content=[...(result.content||[]),{type:'text',text:BASELINE_CHECK_NOTICE}];
   audit({kind:'baseline-check',digest:job.attackBaseline.digest});
  }else result=await upstream(method,params);
  audit({kind:'result',name,result});
  // Only attackers call check. Grounders keep their existing tool set and error
  // handling: granting check would expose the memo their brief deliberately withholds.
  if(mode==='attacker'&&name==='check'){
   if(!isMachineCheckReport(result))return deny('Tetel check did not return a recognizable machine-check report');
   return result; // A clean or failing verdict is data, not a failed evidence pass.
  }
  if(result.isError){
   if(name==='look'||(name==='run'&&!isPin(args.command)))return result;
   // A refused record still latches: evidence persistence failed, so the pass
   // must not proceed as though its verdict ledger were complete.
   failed=true;throw Error('Tetel refused '+name+': '+JSON.stringify(result));
  }
  if(name==='run'&&isPin(args.command)){
   const text=(result.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');let captured;
   try{captured=result.structuredContent||JSON.parse(text)}catch{failed=true;throw Error('Pin output is not structured evidence')}
   if(captured.exit_code!==0||typeof captured.output!=='string'||captured.output.trim()!==job.pin){failed=true;throw Error('Repository pin mismatch')}
   pinned=true;
  }
  return result;
 },TOOL_SETS[mode]);
 let pending=Promise.resolve();
 return Object.freeze({request(method,params){const operation=pending.then(async()=>{try{return await base.request(method,params)}catch(error){failed=true;audit({kind:'gate-error',method,message:error.message});throw error}});pending=operation.catch(()=>{});return operation}});
}
module.exports={createBoundGate,TOOL_SETS,summarizeGateAudit,readScopeInstructions};
