'use strict';
// Local protocol double only. No file, profile, network or model operations.
const readline = require('node:readline');
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const timer = setTimeout(() => process.exit(2), 10000);
const lines = readline.createInterface({input: process.stdin});
let meter = false;
const threadId = 'thread-' + process.pid, turnId = 'turn-' + process.pid;
const tool = (id, name, args) => ({id, method: 'item/tool/call', params: {threadId, turnId, callId: 'call-' + id, tool: name, arguments: args}});
lines.on('line', text => {
  const m = JSON.parse(text);
  if (m.method === 'initialize') { meter = m.params.clientInfo.name.endsWith('meter'); send({id: m.id, result: {}}); }
  else if (m.method === 'account/read') send({id: m.id, result: {account: {type: 'chatgpt'}, workspaceRouting: {chatgptAccountId: 'PRIVATE-ID', backendOrigin: 'PRIVATE-ORIGIN'}}});
  else if (m.method === 'account/rateLimits/read') send({id: m.id, result: {accountId: 'PRIVATE-ID', ordinaryUsageAllowed: true, rateLimits: {limitId: 'codex', primary: {windowDurationMins: 300, usedPercent: 10, resetsAt: 1800003600}, secondary: {windowDurationMins: 10080, usedPercent: 25, resetsAt: 1800604800}}}});
  else if (m.method === 'thread/start') { if (meter) process.exit(3); send({id: m.id, result: {thread: {id: threadId}, model: 'gpt-6.1-sol', modelProvider: 'openai', reasoningEffort: 'medium'}}); }
  else if (m.method === 'turn/start') {
    const grant = JSON.parse(m.params.input[0].text.split('Host grant: ')[1].split('\n')[0]);
    const ordinal = grant.task.itemId === 'fixed-item' ? process.argv[2] : 'invalid';
    globalThis.handoffStatus = ordinal === 'author1' ? 'continue' : 'done';
    process.stdout.write(JSON.stringify({id: m.id, result: {turn: {id: turnId}}}) + '\n' + JSON.stringify(tool(100, 'lonic_context', {})) + '\n');
  } else if (m.id === 100 && m.result) send(tool(101, 'lonic_handoff', {status: globalThis.handoffStatus, reason: 'EXAMPLE completed', itemId: 'fixed-item', context: {summary: 'EXAMPLE', completedChecks: [], openFindings: [], nextActions: [], sourceState: []}}));
  else if (m.id === 101 && m.result) send({method: 'turn/completed', params: {threadId, turn: {id: turnId, status: 'completed'}}});
});
lines.once('close', () => { clearTimeout(timer); process.exit(0); });
