#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
function noLinks(target){const full=path.resolve(target),root=path.parse(full).root;let current=root;for(const part of full.slice(root.length).split(path.sep).filter(Boolean)){current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())throw Error('Refusing linked job path: '+current)}catch(e){if(e.code!=='ENOENT')throw e}}}
function within(root,file){const rel=path.relative(root,file);return !rel||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep))}
function createJob({configFile,mode,repo,memo}){
 if(!['grounder','attacker'].includes(mode))throw Error('Choose grounder or attacker');
 if(!configFile||!repo||!memo)throw Error('Config, source repository and rendered memo are required');
 noLinks(configFile);const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
 const known=new Set(['schema','codex','tetel','model','allowedCommands','runRoot','timeoutMs']);
 if(Object.keys(config).some(k=>!known.has(k))||config.schema!==1)throw Error('Unsupported evidence configuration');
 for(const field of ['codex','tetel','model'])if(typeof config[field]!=='string'||!config[field].trim())throw Error('Missing configuration: '+field);
 if(config.allowedCommands!==undefined&&(!Array.isArray(config.allowedCommands)||config.allowedCommands.some(c=>!Array.isArray(c)||!c.length||c.some(a=>typeof a!=='string'||!a||a.includes('\0')))))throw Error('Commands must be exact nonempty argv arrays');
 const timeoutMs=config.timeoutMs??240000;if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>900000)throw Error('Timeout must be 1000..900000 ms');
 noLinks(repo);noLinks(memo);repo=fs.realpathSync(repo);memo=fs.realpathSync(memo);
 if(!fs.statSync(repo).isDirectory()||!fs.statSync(memo).isFile())throw Error('Expected source directory and memo file');
 if(within(repo,memo))throw Error('Store planning memo outside the source repository');
 const git=args=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',windowsHide:true,timeout:15000}).trim();
 const top=fs.realpathSync(git(['rev-parse','--show-toplevel']));if(top!==repo)throw Error('Use the source Git worktree root');
 const pin=git(['rev-parse','HEAD']);if(!/^[0-9a-f]{40}$/.test(pin))throw Error('Expected a full source commit ID');
 const parent=path.resolve(config.runRoot||path.join(os.tmpdir(),'lonic-codex-evidence'));noLinks(parent);
 if(within(repo,parent))throw Error('Evidence run state must be outside the source repository');
 fs.mkdirSync(parent,{recursive:true});noLinks(parent);const root=fs.mkdtempSync(path.join(parent,mode+'-'));const workDir=path.join(root,'work');fs.mkdirSync(workDir);
 const workspace=mode+'-'+crypto.randomBytes(12).toString('hex');
 const tetelEnv=process.platform==='win32'?{LOCALAPPDATA:path.join(root,'tetel-state')}:{XDG_STATE_HOME:path.join(root,'tetel-state')};
 const job={mode,codex:config.codex,tetel:config.tetel,model:config.model,repo,pin,memo,workspace,workDir,jobPath:path.join(root,'job.json'),audit:path.join(root,'audit.jsonl'),events:path.join(root,'events.jsonl'),result:path.join(root,'result.json'),tetelEnv,allowedCommands:[...(config.allowedCommands||[]),...(mode==='attacker'?[['wc','-l',memo]]:[])]};
 fs.writeFileSync(job.jobPath,JSON.stringify(job,null,2)+'\n',{flag:'wx',mode:0o600});
 return {job,timeoutMs};
}
async function main(argv){const options={};for(let i=0;i<argv.length;i++){const arg=argv[i];if(!['--config','--mode','--repo','--memo'].includes(arg)||options[arg]||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Usage: node evidence.cjs --config FILE --mode grounder|attacker|attack-pair --repo SOURCE_ROOT --memo MEMO');options[arg]=argv[++i]}
 if(options['--mode']==='attack-pair'){const result=await require('./attack-pair.cjs').runAttackPair({configFile:options['--config'],repo:options['--repo'],memo:options['--memo']});console.log(JSON.stringify(result));return result.pairComplete?0:2}
 const {job,timeoutMs}=createJob({configFile:options['--config'],mode:options['--mode'],repo:options['--repo'],memo:options['--memo']});console.log(JSON.stringify({job:job.jobPath,result:job.result,existingLogin:true}));
 try{const result=await require('./run-isolated-grounder.cjs').runEvidence(job,{timeoutMs});console.log(JSON.stringify(result));return result.completion.groundingComplete||result.completion.attackComplete?0:2}
 catch(error){if(!fs.existsSync(job.result))fs.writeFileSync(job.result,JSON.stringify({turnStatus:'failed',error:error.message,job:job.jobPath},null,2)+'\n');throw error}
}
module.exports={createJob,main};
if(require.main===module)main(process.argv.slice(2)).then(code=>process.exitCode=code).catch(error=>{console.error(error.message);process.exitCode=1});
