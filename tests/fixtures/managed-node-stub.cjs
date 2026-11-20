'use strict';
// Harmless test-only child. Never launches a model, opens a profile or runs code
// supplied by an author. Every branch has an independent finite exit deadline.
const {spawn}=require('node:child_process');
const [role,nonce]=process.argv.slice(2);
if(!nonce?.startsWith('EXAMPLE-'))process.exit(2);
const deadline=setTimeout(()=>process.exit(0),20000);
process.on('message',message=>{if(message?.nonce===nonce && message.action==='exit')process.exit(0);});
if(role==='root'){
  const leaf=spawn(process.execPath,[__filename,'leaf',nonce],{windowsHide:true,detached:true,stdio:['ignore','ignore','ignore','ipc']});
  leaf.once('spawn',()=>process.send?.({nonce,leafPid:leaf.pid}));
  process.stdin.resume();
  // Ignore stdin EOF to exercise observed forced termination; child remains alive.
}else if(role==='gate'){
  process.stdout.write('READY\n');process.stdin.resume();process.stdin.once('end',()=>{clearTimeout(deadline);process.exit(0);});
}else if(role==='gate-protocol'){
  const readline=require('node:readline').createInterface({input:process.stdin});let request;
  readline.on('line',line=>{if(!request){request=JSON.parse(line);process.stdout.write(JSON.stringify({event:'locked',intentId:request.intentId})+'\n');}else if(line==='ping'){process.stdout.write(JSON.stringify({event:'held',intentId:request.intentId})+'\n');}});
  readline.on('close',()=>process.exit(0));
}else if(role!=='leaf')process.exit(2);
