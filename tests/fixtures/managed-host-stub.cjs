'use strict';
const disabledContext=Object.fromEntries(require('../../codex/runtime/managed-instruction-config.cjs').BUILTIN_CONTEXT_KEYS.map(k=>[k,false]));

// Protocol double: no filesystem/profile/network/model operations.
const readline = require('node:readline');
const [scenario, sequence] = process.argv.slice(2);
const project = process.cwd(), id = 'thread-' + process.pid, turn = 'turn-' + process.pid;
const timer = setTimeout(() => process.exit(2), 20000);
const lines = readline.createInterface({input: process.stdin});
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
let name;
const tool = (n, method, args) => ({id: n, method: 'item/tool/call', params: {threadId: id, turnId: turn, callId: 'call-' + n, tool: method, arguments: args}});
lines.on('line', text => {
  const m = JSON.parse(text);
  if (m.method === 'initialize') { name = m.params.clientInfo.name; send({id: m.id, result: {}}); send({method:'remoteControl/status/changed',params:{example:'PRIVATE-notification-payload'}}); }
  else if (m.method === 'config/read') send({id: m.id, result: {config: {projects: scenario === "untrusted" ? {} : {[project.toLowerCase()]:{trust_level:"trusted"}},...disabledContext,model: 'gpt-6.2-sol', model_provider: 'openai', features:{plugins:scenario==='plugins-on'?true:false,hooks:false,apps:false}, plugins:{'EXAMPLE-disabled-plugin':{enabled:true}}}, origins: {}, layers: [{name: {type: 'sessionFlags'}, config: {}, version: 'EXAMPLE'}]}});
  else if (m.method === 'hooks/list') send({id: m.id, result: {data: [{cwd: project, errors: [], warnings: [], hooks: scenario === 'hook' || scenario === 'thread-hook' && m.params.threadId ? [{enabled: true, source: 'project', eventName: 'preToolUse', trustStatus: 'trusted', handlerType: 'command', currentHash: 'EXAMPLE', sourcePath: project + '/hooks.json'}] : []}]}});
  else if (m.method === 'skills/list') send({id: m.id, result: {data: [{cwd: project, errors: [], skills: []}]}});
  else if (m.method === 'account/read') send({id: m.id, result: {account: {type: 'chatgpt', email: 'PRIVATE-user@example.invalid'}, workspaceRouting: {chatgptAccountId: 'PRIVATE-ID', backendOrigin: 'PRIVATE-ORIGIN'}}});
  else if (m.method === 'account/rateLimits/read') send({id: m.id, result: {accountId: 'PRIVATE-ID', ordinaryUsageAllowed: true, rateLimits: {limitId: 'codex', primary: {windowDurationMins: 300, usedPercent: 10, resetsAt: Math.floor(Date.now() / 1000) + 3600}, secondary: {windowDurationMins: 10080, usedPercent: 25, resetsAt: 2000000000}}}});
  else if (m.method === 'thread/start') {
    if (!name.endsWith('author') || m.params.environments.length || m.params.selectedCapabilityRoots.length || !m.params.baseInstructions) process.exit(3);
    send({id: m.id, result: {cwd: project, thread: {id}, instructionSources: scenario === 'unknown-source' ? [project + '/unknown.md'] : [], model: 'gpt-6.2-sol', modelProvider: 'openai', reasoningEffort: 'medium'}});
  } else if (m.method === 'turn/start') process.stdout.write(JSON.stringify({id: m.id, result: {turn: {id: turn}}}) + '\n' + JSON.stringify(tool(100, 'lonic_context', {})) + '\n');
  else if (m.id === 100 && m.result) send(tool(101, 'lonic_handoff', {status: sequence === '1' ? 'continue' : 'stop', reason: 'EXAMPLE bounded work', itemId: 'fixed-item', context: {summary: 'EXAMPLE handoff preserved', completedChecks: [], openFindings: [], nextActions: ['operator review'], sourceState: []}}));
  else if (m.id === 101 && m.result) send({method: 'turn/completed', params: {threadId: id, turn: {id: turn, status: 'completed'}}});
  else if (m.method === 'turn/interrupt') send({id: m.id, result: {}});
});
lines.on('close', () => { clearTimeout(timer); process.exit(0); });
