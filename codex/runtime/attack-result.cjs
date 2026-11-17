'use strict';
const path=require('node:path');
const {assessGrounding}=require('./grounding-result.cjs');
const BASELINE_CHECK_NOTICE='Adapter notice: this is the shared check captured before either initial attack. Later peer findings are withheld until both passes finish. This is not a fresh closure check.';
function isMachineCheckReport(result){
 // Tetel check uses isError for failing verdicts as well as call failures.
 // Recognize its report envelope, including paged reports, not arbitrary error text.
 if(!result||!Array.isArray(result.content)||!result.content.length||
    (result.isError!==undefined&&typeof result.isError!=='boolean')||
    result.content.some(c=>!c||c.type!=='text'||typeof c.text!=='string'))return false;
 const blocks=result.content.map(c=>c.text);
 if(blocks.length===2&&blocks[1]===BASELINE_CHECK_NOTICE)blocks.pop();
 if(blocks.length!==1)return false;
 const lines=blocks[0].replace(/\r\n/g,'\n').trimEnd().split('\n');
 const page=/^\[tetel: showed check rows ([1-9]\d*)-([1-9]\d*) of ([1-9]\d*); not shown: .+\]$/.exec(lines[0]);
 if(page){const [first,last,total]=page.slice(1).map(Number);if(![first,last,total].every(Number.isSafeInteger)||first>last||last>total)return false;lines.shift()}
 const header=/^machine-checked: (?:clean|([1-9]\d*) failing \(([^\n]+)\)) — \S[^\n]*$/.exec(lines[0]);
 if(!header||!/^checked by tetel \S[^\n]*$/.test(lines.at(-1)))return false;
 const human=lines.findIndex(line=>/^human-owed: \S.* — none of this is settled by a passing check$/.test(line));
 if(human<2||human>=lines.length-1)return false;
 const rows=lines.slice(1,human).filter(line=>line.startsWith('  - ')).map(line=>/^  - \[([a-z][a-z-]*)\] \S/.exec(line));
 if(rows.some(row=>!row))return false;
 if(header[1]){
  const counts=header[2].split(', ').map(part=>/^([a-z][a-z-]*(?: [a-z][a-z-]*)*) ([1-9]\d*)$/.exec(part));
  if(counts.some(c=>!c)||new Set(counts.map(c=>c[1])).size!==counts.length)return false;
  const total=Number(header[1]);
  if(!Number.isSafeInteger(total)||counts.reduce((sum,c)=>sum+Number(c[2]),0)!==total)return false;
  if(rows.some(row=>!counts.some(c=>c[1]===row[1])))return false;
  for(const c of counts){const shown=rows.filter(row=>row[1]===c[1]).length;if(page?shown>Number(c[2]):shown!==Number(c[2]))return false}
 }else if(rows.length)return false;
 return true;
}
function capturedMemoRange(range,lines,text){
 if(!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||range.start<1||range.end<range.start)return null;
 const bound=Math.min(range.end,lines.length),contains=expected=>expected&&('\n'+text+'\n').includes('\n'+expected+'\n');
 if(contains(lines.slice(range.start-1,bound).join('\n')))return {start:range.start,end:bound};
 // A bounded look can return only the requested prefix. Credit the declared
 // returned range only after checking its bounds AND its complete literal text.
 const output=text.split('\n'),headerIndex=/^==> .* <==$/.test(output[0])?1:0;
 const page=/^\[tetel: showed lines ([1-9]\d*)-([1-9]\d*) of ([1-9]\d*);[^\n]*\]$/.exec(output[headerIndex]);
 if(!page)return null;
 const [first,last,total]=page.slice(1,4).map(Number);
 if(![first,last,total].every(Number.isSafeInteger)||first!==range.start||last<first||last>bound||total!==lines.length)return null;
 const expected=lines.slice(first-1,last).join('\n'),body=output.slice(headerIndex+1).join('\n');
 if(!expected||!('\n'+body+'\n').includes('\n'+expected+'\n'))return null;
 return {start:first,end:last};
}
function assessAttack(input){
 const ledger=assessGrounding({...input,before:{...input.before,owed:[]},after:{...input.after,owed:[]}});
 const result={attackComplete:false,designApproved:false,status:ledger.status,recorded:ledger.recorded,reasons:[...ledger.reasons],report:null};
 const {audit,memo,memoText,report}=input;
 const normalize=s=>s.replace(/\r\n/g,'\n');const lines=normalize(memoText).split('\n');if(lines.at(-1)==='')lines.pop();const covered=new Set(),facts=new Set();let pending=[];let checked=false;
 const equal=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
 for(const entry of audit){
  if(entry.kind==='forward')pending.push(entry);
  if(entry.kind!=='result')continue;const request=pending.shift();if(!request||request.name!==entry.name)continue;
  if(request.name==='check'&&typeof request.arguments.file==='string'&&equal(path.resolve(request.arguments.file),path.resolve(memo))&&isMachineCheckReport(entry.result))checked=true;
  if(entry.result?.isError)continue;
  if(request.name==='fact'){try{const v=entry.result.structuredContent||JSON.parse((entry.result.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n'));if(typeof v.id==='string')facts.add(v.id)}catch{}}
  if(request.name==='look'&&equal(path.resolve(request.arguments.path),path.resolve(memo))&&!request.arguments.grep){
   const range=request.arguments.lines||{start:1,end:lines.length};
   const text=normalize((entry.result.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n'));
   const captured=capturedMemoRange(range,lines,text);
   if(captured)for(let n=captured.start;n<=captured.end;n++)covered.add(n);
  }
 }
 if(!checked)result.reasons.push('The attacker did not run check on the assigned memo');
 if(covered.size!==lines.length||!lines.length)result.reasons.push('The attacker did not capture the complete memo');
 try{
  if(!report||!Array.isArray(report.targets)||!report.targets.length||report.targets.some(t=>typeof t!=='string'||!t.trim()))throw Error('A non-empty target cone is required');
  for(const field of ['findings','missingClaims','routed','unresolved'])if(!Array.isArray(report[field]))throw Error('Missing report field: '+field);
  if(!['yes','no'].includes(report.worthwhile?.answer)||typeof report.worthwhile.reason!=='string'||!report.worthwhile.reason.trim())throw Error('Worthwhile judgment is required');
  for(const f of report.findings){if(typeof f.changesBuild!=='boolean'||typeof f.explanation!=='string'||!f.explanation.trim()||!ledger.recorded.some(r=>r.claim===f.claim&&r.verdict===f.verdict&&r.fromFact===f.fact))throw Error('Finding lacks a matching witnessed record or build-impact judgment')}
  for(const r of ledger.recorded)if(!report.findings.some(f=>f.claim===r.claim&&f.verdict===r.verdict&&f.fact===r.fromFact))throw Error('A recorded finding is missing from the report');

  for(const m of report.missingClaims)if(typeof m.decision!=='string'||!m.decision.trim()||typeof m.neededProposition!=='string'||!m.neededProposition.trim()||typeof m.changesBuild!=='boolean'||!Array.isArray(m.facts)||!m.facts.length||m.facts.some(f=>!facts.has(f)))throw Error('Missing-claim finding lacks its decision, proposition or captured facts');
  if(report.routed.some(x=>typeof x!=='string')||report.unresolved.some(x=>typeof x!=='string'))throw Error('Routed and unresolved entries must be strings');
  result.report=report;
 }catch(e){result.reasons.push(e.message)}
 if(!result.reasons.length&&ledger.groundingComplete){result.attackComplete=true;result.status='attack-complete'}else if(result.status==='nothing-owed'||result.status==='graded')result.status='incomplete';
 return result;
}
module.exports={assessAttack,isMachineCheckReport,BASELINE_CHECK_NOTICE};
