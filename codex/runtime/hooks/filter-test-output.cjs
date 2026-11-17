'use strict';
const path=require('node:path');const {validTokens}=require('./test-output.cjs');
function testCommand(tokens){const [program,first,second]=tokens;return (program==='npm'&&(first==='test'||first==='run'&&/^test(?::[A-Za-z0-9_-]+)?$/.test(second||'')))||(['pnpm','yarn','bun'].includes(program)&&first==='test')||(['npx','pnpm','yarn','bunx'].includes(program)&&['vitest','jest'].includes(first))||(['vitest','jest','pytest'].includes(program))||(program==='go'&&first==='test')||(program==='node'&&first==='--test')||(['python','python3'].includes(program)&&first==='-m'&&second==='pytest')}
function rewrite(event){
 if(event?.hook_event_name!=='PreToolUse'||event.tool_name!=='Bash'||typeof event.tool_input?.command!=='string'||process.env.FULL_TEST_OUTPUT==='1')return {};
 const command=event.tool_input.command;if(command.includes('FULL_TEST_OUTPUT=1')||/[\r\n]/.test(command))return {};
 const tokens=command.trim().split(/\s+/);if(!validTokens(tokens)||!testCommand(tokens))return {};
 const encoded=Buffer.from(path.join(__dirname,'test-output.cjs'),'utf8').toString('base64');
 const js="require(Buffer.from('"+encoded+"','base64').toString()).main(process.argv.slice(1)).catch(e=>{console.error(e.message);process.exitCode=1})";
 return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow',updatedInput:{...event.tool_input,command:'node -e "'+js+'" -- '+tokens.join(' ')}}};
}
module.exports={rewrite,testCommand};
if(require.main===module){let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{try{process.stdout.write(JSON.stringify(rewrite(JSON.parse(input))))}catch(error){process.stderr.write(error.message);process.exitCode=1}})}
