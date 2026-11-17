'use strict';
const fs=require('node:fs');const {rpc}=require('./rpc-client.cjs');const {createBoundGate}=require('./bound-grounder-gate.cjs');
const job=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const upstream=rpc(job.tetel,['mcp'],{cwd:job.repo,env:job.tetelEnv});
const audit=entry=>fs.appendFileSync(job.audit,JSON.stringify({...entry,time:new Date().toISOString()})+'\n');
const ready=(async()=>{const init=await upstream.call('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'bound-grounder-gate-prototype',version:'1'}});upstream.notify('notifications/initialized');const catalog=await upstream.call('tools/list');return {init,gate:createBoundGate(catalog,(m,p)=>upstream.call(m,p),job,audit)}})();
let pending='';process.stdin.setEncoding('utf8');process.stdin.on('data',data=>{pending+=data;let n;while((n=pending.indexOf('\n'))>=0){const line=pending.slice(0,n);pending=pending.slice(n+1);let request;try{request=JSON.parse(line)}catch{continue}if(request.id===undefined)continue;(async()=>{try{
 const {init,gate}=await ready;let result;
 if(request.method==='initialize')result={protocolVersion:request.params?.protocolVersion||'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'lonic-grounder-gate-prototype',version:'1'}};
 else if(request.method==='ping')result={};
 else if(request.method==='resources/list')result={resources:[]};
 else if(request.method==='resources/templates/list')result={resourceTemplates:[]};
 else result=await gate.request(request.method,request.params);
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
 }catch(error){audit({kind:'rejected-request',method:request.method,message:error.message});process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:error.code||-32000,message:error.message}})+'\n')}})();}});
process.stdin.on('end',()=>upstream.close());process.on('SIGTERM',()=>{upstream.close();process.exit(0)});