'use strict';
// A completed model turn is not evidence that all grounding work was recorded.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function parseBrief(result){
 if(result?.isError)throw Error('Tetel brief failed');
 const text=(result?.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
 const limit=32768,cut=/(?:^|\n)\[tetel: this reply was cut to its first \d+ of \d+ bytes to stay within the 32768-byte reply bound\]\s*$/;
 const payload=result?.structuredContent ? JSON.stringify(result.structuredContent) : text;
 if(Buffer.byteLength(payload,'utf8')>limit||cut.test(text))throw Error('BRIEF_REPLY_TOO_LARGE: the complete claim brief must fit within 32768 UTF-8 bytes. Split claims into smaller independently groundable memos, move explanation to prose, render/check again and obtain a fresh complete brief. Do not grade a truncated subset.');
 let value;try{value=result?.structuredContent||JSON.parse(text);}catch{throw Error('BRIEF_REPLY_INVALID_JSON: complete JSON is required; if the reply reached the 32768-byte bound, split the claims before grounding.');}
 if(!Number.isInteger(value.floor)||value.floor<1||!Array.isArray(value.claims)||!Array.isArray(value.owed))throw Error('Unsupported brief shape');
 const ids=new Set();for(const claim of value.claims){if(!/^C[1-9][0-9]*$/.test(claim.id)||ids.has(claim.id)||typeof claim.proposition!=='string'||claim.scope!=='WITHHELD')throw Error('Invalid or unwithheld brief claim');ids.add(claim.id)}
 if(new Set(value.owed).size!==value.owed.length||value.owed.some(id=>!ids.has(id)))throw Error('Invalid owed list');
 return {floor:value.floor,claims:value.claims.map(({id,proposition})=>({id,proposition})),owed:[...value.owed]};
}
function artifactDigest(memo){
 const h=crypto.createHash('sha256');
 function add(file,label){const stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw Error('Memo artifacts must not be symlinks');if(stat.isDirectory()){h.update('D\0'+label+'\0');for(const name of fs.readdirSync(file).sort())add(path.join(file,name),label+'/'+name)}else if(stat.isFile()){const bytes=fs.readFileSync(file);h.update('F\0'+label+'\0'+bytes.length+'\0');h.update(bytes)}else throw Error('Unsupported memo artifact')}
 add(memo,'memo');add(memo+'.tetel','snapshot');return h.digest('hex');
}
function ledgerBytes(memo){try{return fs.readFileSync(memo+'.evidence.jsonl')}catch(error){if(error.code==='ENOENT')return Buffer.alloc(0);throw error}}
function assessGrounding({before,after,turnStatus,initialDigest,finalDigest,initialLedger,finalLedger,recordReceipts,gateErrors=[]}){
 const result={groundingComplete:false,designApproved:false,status:'incomplete',owedBefore:before.owed,owedAfter:after.owed,recorded:[],reasons:[]};
 if(turnStatus!=='completed'||gateErrors.length){result.status='failed';result.reasons.push('The turn did not complete cleanly');return result}
 if(initialDigest!==finalDigest||before.floor!==after.floor||JSON.stringify(before.claims)!==JSON.stringify(after.claims)){result.status='invalidated';result.reasons.push('Memo, snapshot, propositions, or confirmation floor changed during the pass');return result}
 if(!Buffer.isBuffer(initialLedger)||!Buffer.isBuffer(finalLedger)||!finalLedger.subarray(0,initialLedger.length).equals(initialLedger)){result.status='invalidated';result.reasons.push('The existing evidence ledger changed');return result}
 if(initialLedger.length&&initialLedger.at(-1)!==10){result.status='invalidated';result.reasons.push('The initial evidence ledger has an incomplete line');return result}
 let appended;try{const suffix=finalLedger.subarray(initialLedger.length).toString('utf8');if(suffix&&!suffix.endsWith('\n'))throw Error('Partial ledger line');appended=suffix.trim()?suffix.trim().split('\n').map(JSON.parse):[]}catch{result.reasons.push('New evidence could not be read completely');return result}
 const remaining=[...appended];
 for(const receipt of recordReceipts){
  if(receipt.witnessed!==true||receipt.recorded!==true||!receipt.from_fact||typeof receipt.pass!=='string'){result.reasons.push('A record was not witnessed by a captured fact');continue}
  const found=remaining.findIndex(row=>row.predicateType==='https://github.com/lonic-software/tetel/captured-fact/v1'&&row.subject?.length===1&&row.subject[0].name===receipt.claim&&row.predicate?.pass===receipt.pass&&row.predicate.verdict===receipt.verdict&&Array.isArray(row.predicate.extent)&&row.predicate.extent.length>0);
  if(found<0){result.reasons.push('A witnessed record receipt has no matching ledger entry');continue}
  remaining.splice(found,1);result.recorded.push({claim:receipt.claim,verdict:receipt.verdict,fromFact:receipt.from_fact});
 }
 if(remaining.length)result.reasons.push('Unattributed evidence was appended during the pass');
 for(const id of before.owed)if(!result.recorded.some(row=>row.claim===id))result.reasons.push('No witnessed record from this pass for '+id);
 if(after.owed.length)result.reasons.push('The current brief still has owed claims');
 if(!result.reasons.length){result.groundingComplete=true;result.status=before.owed.length?'graded':'nothing-owed'}
 return result;
}
module.exports={parseBrief,artifactDigest,ledgerBytes,assessGrounding};
