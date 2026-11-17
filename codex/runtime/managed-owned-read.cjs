'use strict';
const {auditNotification} = require('./managed-notification-audit.cjs');
const {spawn} = require('node:child_process');
const {createManagedProcess} = require('./managed-process.cjs');
const {createManagedRpc} = require('./managed-rpc.cjs');
const {isRefusal} = require('./managed-inventory-rules.cjs');
const allowed = new Set(['config/read','hooks/list','skills/list','account/read','account/rateLimits/read']);
async function ownedRead({launch,backend,journal,intent,verifyProfile,operation,signal,spawnChild=spawn,audit,timeoutMs=120000,closeTimeoutMs=60000}) {
  let owner,rpc,completed=false,stopped=false,value,cleanup,primary;
  let rejectStop,updates=0,initialAccountOpen=true;
  const interrupted=new Promise((_,reject)=>{rejectStop=reject;});interrupted.catch(()=>{});
  const stop=()=>{if(!stopped){stopped=true;rpc?.revoke();rejectStop(Error('MANAGED_INSPECTION_STOPPED'));}};
  const wait=p=>Promise.race([p,interrupted]);
  const timer=setTimeout(stop,timeoutMs);signal?.addEventListener('abort',stop,{once:true});
  try {
    if(signal?.aborted||verifyProfile()!==true)throw Error();
    journal.register(intent);
    owner=createManagedProcess({mode:'managed',backend,timeoutMs:30000,closeTimeoutMs,onSpawnAttempt:()=>journal.recordSpawnAttempt(),onSpawned:c=>journal.recordProcess(c),onNoProcess:e=>journal.recordNoProcess(e),onIdentity:p=>journal.recordIdentity(p),onStop:stop});
    // Join bounded start despite transport errors: no late journal writes.
    const started=await owner.start({registeredIntent:intent,spawn:()=>{
      if(verifyProfile()!==true)throw Error();
      const child=spawnChild(launch.exe,launch.args,{cwd:launch.cwd,env:{...launch.env},windowsHide:true,stdio:['pipe','pipe','pipe']});
      rpc=createManagedRpc(child,{canReply:()=>false,track:p=>owner.trackHandler(p),onFailure:stop,onRequest:()=>{stop();throw Error('MANAGED_INSPECTION_REQUEST_REFUSED');},onEvent:m=>{auditNotification(audit,m);if(m.method==='account/updated'&&(!initialAccountOpen||++updates>1))stop();}});
      return child;
    }});
    if(!started.allowed)throw Error();
    await wait(rpc.call('initialize',{clientInfo:{name:'lonic-managed-inspector',version:'1'},capabilities:{experimentalApi:true}},{timeoutMs:60000}));rpc.notify('initialized');
    const reader=Object.freeze({call(method,params){if(!allowed.has(method))throw Error('MANAGED_INSPECTION_METHOD_REFUSED');return wait(rpc.call(method,params,{timeoutMs:45000,onResult:method==='account/read'?()=>{initialAccountOpen=false;}:undefined}));}});
    value=await wait(operation(reader));if(verifyProfile()!==true)throw Error();completed=true;
  } catch(error) { primary=isRefusal(error)?error:Error('MANAGED_INSPECTION_FAILED'); if(!isRefusal(error))stop(); }
  finally {
    clearTimeout(timer);signal?.removeEventListener('abort',stop);rpc?.dispose();
    if(owner)cleanup=await owner.close({turnCompleted:completed&&!stopped,admissionRefused:isRefusal(primary)&&!stopped});
  }
  if(owner?.status().noProcess)primary=Object.assign(Error('PROCESS_SPAWN_FAILED'),{code:'PROCESS_SPAWN_FAILED',ruleId:'SPAWN_NO_PROCESS'});
  const clean=cleanup?.allowed===true&&verifyProfile()===true;
  if(clean&&(isRefusal(primary)||owner?.status().noProcess)) {
    journal.settle(intent);throw Object.assign(primary,{cleanRefusal:true,recoveryRequired:false});
  }
  if(primary||stopped||!clean)throw Object.assign(primary||Error('MANAGED_INSPECTION_FAILED'),{cleanRefusal:false,recoveryRequired:true,cleanupReason:cleanup?.reason||'MANAGED_CLOSE_UNCERTAIN'});
  journal.settle(intent);return value;
}
module.exports={ownedRead};
