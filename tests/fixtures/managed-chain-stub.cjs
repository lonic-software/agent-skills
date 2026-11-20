'use strict';
// Test-owned Node processes only; never executes arbitrary commands or profiles.
const {spawn}=require('node:child_process');
const [role,nonce]=process.argv.slice(2);
if(!nonce?.startsWith('EXAMPLE-'))process.exit(2);
setTimeout(()=>process.exit(0),45000);
let nested;
function launch(kind){
  nested=spawn(process.execPath,[__filename,kind,nonce],{windowsHide:true,detached:true,stdio:['ignore','ignore','ignore','ipc']});
  nested.on('message',m=>{if(m?.nonce===nonce)process.send?.(m);});
  nested.on('exit',()=>process.send?.({nonce,event:'nested-exited',pid:nested.pid}));
}
process.on('message',m=>{
  if(m?.nonce!==nonce)return;
  if(m.action==='exit')process.exit(0);
  if(m.action==='spawn' && !nested)launch(role==='chain-root'?'middle':'leaf');
  if(m.action==='exit-middle' && role==='chain-root')nested?.send({nonce,action:'exit'});
});
if(role==='middle')launch('leaf');
else if(role.endsWith('root')){process.stdin.resume();} // Deliberately ignore EOF.
else if(role!=='leaf')process.exit(2);
process.send?.({nonce,event:'ready',role,pid:process.pid,parentPid:process.ppid});
