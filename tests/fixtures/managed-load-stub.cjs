'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const [role,nonce,dir]=process.argv.slice(2);
if(!nonce?.startsWith('EXAMPLE-'))process.exit(2);
const send=m=>process.send?.({nonce,...m});
setTimeout(()=>process.exit(3),90000).unref();
process.on('message',m=>{if(m?.nonce===nonce&&m.action==='exit')process.exit(0)});
function launch(exe,args,options={}){
  const child=spawn(exe,args,{cwd:dir,windowsHide:true,detached:true,stdio:['ignore','ignore','ignore','ipc'],...options});
  child.once('spawn',()=>send({event:'spawn',pid:child.pid,parentPid:process.pid}));
  child.on('message',m=>{if(m?.nonce===nonce)send(m)});return child;
}
if(role==='middle'){
  launch(process.execPath,[__filename,'leaf',nonce,dir]);setTimeout(()=>process.exit(0),8000);
}else if(role==='leaf'){setTimeout(()=>process.exit(0),18000);
}else if(role==='short-middle'){
  launch(process.execPath,[__filename,'short-leaf',nonce,dir]);setTimeout(()=>process.exit(0),30);
}else if(role==='short-leaf'){setTimeout(()=>process.exit(0),150);
}else if(role==='root'){
  process.stdin.resume();process.stdin.on('end',()=>process.exit(0));
  const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(dir,'empty.config'),GIT_CONFIG_SYSTEM:path.join(dir,'empty.config'),GIT_TERMINAL_PROMPT:'0'};
  fs.writeFileSync(env.GIT_CONFIG_GLOBAL,'');fs.mkdirSync(path.join(dir,'empty-hooks'));
  const prefix=['-c','user.name=EXAMPLE Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath='+path.join(dir,'empty-hooks')];
  const counts={gitInit:0,gitAdd:0,gitCommit:0,gitGc:0,cmdChain:0,shortChains:0};
  async function command(exe,args){const c=launch(exe,args,{env,stdio:['ignore','ignore','ignore']});await new Promise((resolve,reject)=>{c.once('error',()=>reject(Error('FIXTURE_COMMAND_FAILED')));c.once('exit',code=>code===0?resolve():reject(Error('FIXTURE_COMMAND_FAILED')))});}
  process.once('message',async m=>{
    if(m?.nonce!==nonce||m.action!=='run')return;
    try{
      const started=Date.now();await command('git',[...prefix,'init','--quiet']);counts.gitInit++;
      launch(process.execPath,[__filename,'middle',nonce,dir]);
      do{
        fs.writeFileSync(path.join(dir,'sample.txt'),String(counts.gitCommit));
        await command('git',[...prefix,'add','sample.txt']);counts.gitAdd++;
        await command('git',[...prefix,'commit','--quiet','-m','EXAMPLE temporary load fixture']);counts.gitCommit++;
        await command('git',[...prefix,'gc','--auto']);counts.gitGc++;
        await command('cmd.exe',['/d','/c','echo EXAMPLE>nul && echo CHAIN>nul']);counts.cmdChain++;
        const c=launch(process.execPath,[__filename,'short-middle',nonce,dir]);await new Promise(r=>c.once('exit',r));counts.shortChains++;
      }while(Date.now()-started<30000);
      send({event:'workload-done',elapsedMs:Date.now()-started,counts});
    }catch{send({event:'workload-failed'});}
  });
}else process.exit(2);
