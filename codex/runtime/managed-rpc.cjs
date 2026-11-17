'use strict';
// Transport on an already-owned child. Never spawns, reads profiles or logs raw
// frames/stderr. Legacy rpc-client.cjs intentionally retains its old behavior.
function createManagedRpc(child,{onEvent=()=>{},onRequest,canReply,track=p=>p,onFailure=()=>{}}={}){
  let sequence=0,buffer='',closed=false,revoked=false;const pending=new Map();
  const fail=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('MANAGED_RPC_FAILED'));}pending.clear();try{onFailure('MANAGED_RPC_FAILED')}catch{}};
  const send=value=>{if(closed||child.stdin.destroyed)throw Error('MANAGED_RPC_CLOSED');child.stdin.write(JSON.stringify(value)+'\n');};
  function frame(m){
    if(m?.id!==undefined&&typeof m.method==='string'){
      const work=Promise.resolve().then(()=>onRequest(m)).then(result=>{
        if(!closed&&!revoked&&canReply())send({jsonrpc:'2.0',id:m.id,result});
      },()=>{if(!closed&&!revoked&&canReply())send({jsonrpc:'2.0',id:m.id,error:{code:-32000,message:'MANAGED_REQUEST_REFUSED'}});});
      try{track(work).catch(fail)}catch{work.catch(()=>{});fail()}return;
    }
    if(m?.id!==undefined&&pending.has(m.id)){
      const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);
      if(m.error){p.reject(Error('MANAGED_RPC_CALL_FAILED'));return;}
      // Binding is synchronous, before another frame in the same chunk is read.
      try{p.onResult?.(m.result);p.resolve(m.result)}catch{p.reject(Error('MANAGED_RPC_BIND_FAILED'));fail()}return;
    }
    if(typeof m?.method==='string')try{onEvent(m)}catch{fail()}
  }
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
    if(closed)return;buffer+=chunk;if(Buffer.byteLength(buffer)>1024*1024){fail();return;}
    let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{frame(JSON.parse(line))}catch{fail();return;}}
  });
  child.stderr.on('data',()=>{});child.stdin.on('error',fail);child.on('error',fail);child.once('exit',()=>{if(!closed)fail();closed=true;});
  return Object.freeze({
    child,
    call(method,params={}, {timeoutMs=30000,onResult}={}){
      return new Promise((resolve,reject)=>{if(closed)return reject(Error('MANAGED_RPC_CLOSED'));const id=++sequence;
        const timer=setTimeout(()=>{pending.delete(id);reject(Error('MANAGED_RPC_TIMEOUT'))},timeoutMs);pending.set(id,{resolve,reject,timer,onResult});
        try{send({jsonrpc:'2.0',id,method,params})}catch{clearTimeout(timer);pending.delete(id);reject(Error('MANAGED_RPC_CLOSED'))}
      });
    },
    notify(method,params){send({jsonrpc:'2.0',method,params});},
    revoke(){revoked=true;},
    dispose(){closed=true;revoked=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('MANAGED_RPC_CLOSED'))}pending.clear();}
  });
}
module.exports={createManagedRpc};
