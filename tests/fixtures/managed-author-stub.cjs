'use strict';
// A local protocol double, not Codex. No files, profiles, network or model.
const readline=require('node:readline');
const now=1800000000000;
const account={account:{type:'chatgpt',email:'EXAMPLE-email'},workspaceRouting:{chatgptAccountId:'EXAMPLE-account',backendOrigin:'EXAMPLE-origin'}};
const usage={accountId:'EXAMPLE-account',ordinaryUsageAllowed:true,rateLimits:{limitId:'codex',primary:{windowDurationMins:300,usedPercent:10,resetsAt:now/1000+3600},secondary:{windowDurationMins:10080,usedPercent:25,resetsAt:now/1000+604800}}};
const send=v=>process.stdout.write(JSON.stringify(v)+'\n');
const tool=(id,name,args)=>({id,method:'item/tool/call',params:{threadId:'thread-1',turnId:'turn-1',callId:'call-'+id,tool:name,arguments:args}});
let startup=true;
const lines=readline.createInterface({input:process.stdin});lines.on('close',()=>process.exit(0));
setTimeout(()=>process.exit(4),10000).unref();
lines.on('line',line=>{
  const m=JSON.parse(line);
  if(m.method==='initialize')send({id:m.id,result:{environmentKeys:Object.keys(process.env)}});
  else if(m.method==='account/read'){if(startup){startup=false;send({method:'account/updated',params:{authMode:'chatgpt'}})}send({id:m.id,result:account});}
  else if(m.method==='account/rateLimits/read')send({id:m.id,result:usage});
  else if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'thread-1'},model:m.params.model,modelProvider:m.params.modelProvider,reasoningEffort:'medium',instructionSources:[]}});
  else if(m.method==='turn/start')process.stdout.write(JSON.stringify({id:m.id,result:{turn:{id:'turn-1'}}})+'\n'+JSON.stringify(tool(100,'lonic_context',{}))+'\n');
  else if(m.id===100&&m.result){const context=JSON.parse(m.result.contentItems[0].text);if(JSON.stringify(context).includes('EXAMPLE-account'))process.exit(5);send(tool(101,'lonic_handoff',{status:'done',reason:'EXAMPLE finished',itemId:'fixed-item',context:{summary:'EXAMPLE context',completedChecks:['local protocol'],openFindings:[],nextActions:['report'],sourceState:[]}}));}
  else if(m.id===101&&m.result)send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});
  else if(m.method==='turn/interrupt')send({id:m.id,result:{}});
});
