#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const {runQueue}=require('./queue-controller.cjs');
const {terminalAsk}=require('./operator.cjs');
async function main(argv){
 if(argv.includes('--managed'))return require('./managed-cli.cjs').main(argv);
 const options={},known=new Set(['--config','--project','--queue','--authority-file','--exclusions-file','--entry','--threshold','--spend','--max-steps','--timeout-ms','--bucket','--interactive','--availability-file','--operator-timeout-ms','--handoff-delay-ms','--item-id','--prices-file']);
 for(let i=0;i<argv.length;i++){const key=argv[i];if(key==='--interactive'){if(options[key])throw Error('Duplicate --interactive');options[key]=true;continue}if(!known.has(key)||Object.hasOwn(options,key)||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Invalid or duplicate queue argument: '+key);options[key]=argv[++i]}
 for(const key of ['--project','--queue','--authority-file'])if(!options[key])throw Error('Required: '+key);
 if((options['--threshold']===undefined)===(options['--spend']===undefined))throw Error('Supply exactly one current-run --threshold PERCENT or --spend PERCENT');
 const config=options['--config']?JSON.parse(fs.readFileSync(options['--config'],'utf8')):require('./resolve-installation.cjs').config(options['--project']);if(config.schema!==1)throw Error('Unsupported runtime configuration');
 const number=key=>options[key]===undefined?undefined:Number(options[key]);
 const abort=new AbortController(),cancel=()=>abort.abort();process.on('SIGINT',cancel);
 let result;try{result=await runQueue({codex:config.codex,model:config.model,project:options['--project'],queue:options['--queue'],authority:fs.readFileSync(options['--authority-file'],'utf8'),exclusions:options['--exclusions-file']?JSON.parse(fs.readFileSync(options['--exclusions-file'],'utf8')):[],entrySkill:options['--entry']||'queue-run',absolute:number('--threshold'),relative:number('--spend'),maxSteps:number('--max-steps'),timeoutMs:number('--timeout-ms')??config.timeoutMs,bucket:options['--bucket'],runRoot:config.runRoot,ask:options['--interactive']?terminalAsk():undefined,availability:options['--availability-file']?JSON.parse(fs.readFileSync(options['--availability-file'],'utf8')):undefined,operatorTimeoutMs:number('--operator-timeout-ms'),handoffDelayMs:number('--handoff-delay-ms'),itemId:options['--item-id'],prices:options['--prices-file']?JSON.parse(fs.readFileSync(options['--prices-file'],'utf8')):undefined,signal:abort.signal});}finally{process.removeListener('SIGINT',cancel)}
 console.log(JSON.stringify(result,null,2));return result.status==='complete'?0:2;
}
module.exports={main};
if(require.main===module)main(process.argv.slice(2)).then(code=>process.exitCode=code).catch(error=>{console.error(error.message);process.exitCode=1});
