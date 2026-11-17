'use strict';
const {spawn}=require('node:child_process');
function rpc(exe,args,{cwd,env,onMessage=()=>{},onStderr=()=>{},onRequest}={}) {
 const p=spawn(exe,args,{cwd,env:{...process.env,...env},windowsHide:true});
 p.stdout.setEncoding('utf8');p.stderr.setEncoding('utf8');
 let sequence=0,buffer='',stderr='',closed=false;const pending=new Map();
 const fail=e=>{for(const h of pending.values()){clearTimeout(h.timer);h.reject(e)}pending.clear()};
 const send=value=>{if(!closed&&!p.stdin.destroyed)p.stdin.write(JSON.stringify(value)+'\n')};
 p.stdin.on('error',fail);p.stderr.on('data',d=>{stderr+=d;onStderr(d.toString())});
 async function message(m){
  try{onMessage(m)}catch(e){fail(e);return}
  // Server requests have an independent ID space; never mistake them for replies.
  if(m.id!==undefined&&m.method){try{if(!onRequest)throw Error('Interactive action is not authorized by this client');const result=await onRequest(m);send({jsonrpc:'2.0',id:m.id,result})}catch(e){send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:e.message}})}return}
  if(pending.has(m.id)){const h=pending.get(m.id);pending.delete(m.id);clearTimeout(h.timer);m.error?h.reject(new Error(JSON.stringify(m.error))):h.resolve(m.result)}
 }
 p.stdout.on('data',d=>{buffer+=d;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);let m;try{m=JSON.parse(line)}catch{continue}void message(m)}});
 p.on('error',fail);p.on('exit',code=>{closed=true;fail(new Error('Process exited '+code+': '+stderr.slice(-1000)))});
 return {pid:p.pid,call(method,params={},timeout=30000){return new Promise((resolve,reject)=>{if(closed)return reject(Error('RPC client closed'));const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Timeout: '+method))},timeout);pending.set(id,{resolve,reject,timer});send({jsonrpc:'2.0',id,method,params})})},notify(method,params){send({jsonrpc:'2.0',method,params})},close(){closed=true;fail(Error('RPC client closed'));p.stdin.end();p.kill()}};
}
module.exports={rpc};
