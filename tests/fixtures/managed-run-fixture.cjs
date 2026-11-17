'use strict';
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const {createHash, randomUUID} = require('node:crypto');
const {accountFingerprint} = require('../../codex/runtime/managed-admission.cjs');
const {createManagedRunBudget} = require('../../codex/runtime/managed-run-budget.cjs');
const {runQueue} = require('../../codex/runtime/queue-controller.cjs');
const now = 1800000000000;
const account = () => ({account: {type: 'chatgpt', email: 'PRIVATE-ACCOUNT'}, workspaceRouting: {chatgptAccountId: 'PRIVATE-ID', backendOrigin: 'PRIVATE-ORIGIN'}});
const usage = (percent = 25) => ({accountId: 'PRIVATE-ID', ordinaryUsageAllowed: true, rateLimits: {limitId: 'codex', primary: {windowDurationMins: 300, usedPercent: 10, resetsAt: now / 1000 + 3600}, secondary: {windowDurationMins: 10080, usedPercent: percent, resetsAt: now / 1000 + 604800}}});
const context = () => ({summary: 'EXAMPLE context', completedChecks: [], openFindings: [], nextActions: [], sourceState: []});
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { const end = Date.now() + 4000; while (!predicate()) { if (Date.now() > end) throw Error('FIXTURE_WAIT_TIMEOUT'); await tick(); } }

function fixture(variant = '') {
  const events = [], children = [], frames = [], budgetRefs = [], identities = [], abort = new AbortController();
  let role, gate = false, ordinal = 0, releaseFirst, releaseMeter, quotaWait;
  const instructions = {complete: true, scopeKey: 'EXAMPLE', sources: [{key: 'host:developer', identity: 'EXAMPLE', sha256: createHash('sha256').update('EXAMPLE').digest('hex')}]};
  const enrollment = {schema: 1, algorithm: 'm2-account-v1', fingerprint: accountFingerprint(account(), usage())};
  const runId = 'EXAMPLE-' + randomUUID();
  const grant = {continuation: true, runId, budget: {runId, relative: 10}, enrollment, instructions,
    selection: {model: 'gpt-6.1-sol', provider: 'openai', effort: 'medium'}, task: {kind: 'file', locator: 'EXAMPLE-task.md', itemId: 'fixed-item'}, authority: 'EXAMPLE bounded task', exclusions: [], developerInstructions: 'EXAMPLE', timeoutMs: 5000, meterTimeoutMs: 2000, processTimeoutMs: 1000, closeTimeoutMs: 2000,
    launch: {exe: 'EXAMPLE-never-executed', args: [], cwd: 'EXAMPLE', env: {CODEX_HOME: 'EXAMPLE-unread', SystemRoot: 'EXAMPLE', TEMP: 'EXAMPLE', TMP: 'EXAMPLE'}}};
  const runBudget = createManagedRunBudget({mode: 'managed', grant: grant.budget});
  const host = {now: () => now, runBudget,
    gate: {acquire: async () => { if (gate) throw Error(); gate = true; events.push('gate-acquire'); return {allowed: true}; }, check: async () => ({allowed: gate}), release: async () => { events.push('gate-release'); gate = false; return {allowed: true}; }},
    inspect: async scope => {
      const inventory = structuredClone(instructions);
      if (variant === 'instruction' && ordinal === 2 && scope === 'thread') inventory.sources[0].sha256 = '0'.repeat(64);
      return {instructions: inventory, hooks: {complete: true, scope, errors: [], warnings: [], hooks: variant === 'hook' && events.includes('closed-meter') ? [{known: true, enabled: true}] : []}};
    },
    verifyInputs: boundary => { events.push(role + ':' + boundary); return !(variant === 'input-drift' && ordinal === 2 && boundary === 'before-turn'); },
    acceptHandoff: (value, n) => { events.push('adopt-' + n); return !(variant === 'adoption' && n === 1); },
    registerIntent: async intent => { role = intent.id.endsWith('meter-2') ? 'meter' : intent.id.endsWith('author-2') ? 'author2' : 'author1'; if (role === 'author1') ordinal = 1; if (role === 'author2') ordinal = 2; events.push('intent-' + role); },
    settleIntent: async intent => { events.push('settled-' + intent.id); return true; },
    backend: {observe: async () => ({complete: true, processes: children.filter(c => !c.gone).map(c => c.row)}), signal: async row => {
      const child = children.find(c => c.row.pid === row.pid && c.row.created === row.created); if (!child) throw Error('NOT_OWN_CHILD');
      if ((variant === 'hold-close' && child.role !== 'author2') || (variant === 'author-survivor' && child.role === 'author1') || (variant === 'meter-survivor' && child.role === 'meter')) return {verified: true, status: 'gone'};
      child.finish(); return {verified: true, status: 'signalled'};
    }},
    spawn: () => {
      if (variant === 'uncertain-spawn' && role === 'author2') throw Error('EXAMPLE-SPAWN-FAILED');
      const child = new EventEmitter(); child.role = role; child.pid = 910000 + children.length; child.row = {pid: child.pid, parentPid: process.pid, created: String(100 + children.length)};
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
      child.finish = () => { if (child.gone) return; child.gone = true; events.push('closed-' + child.role); child.emit('exit', 0); child.stdout.emit('close'); child.stderr.emit('close'); child.emit('close', 0); };
      child.stdin.on('finish', () => { if ((variant === 'author-survivor' && child.role === 'author1') || (variant === 'meter-survivor' && child.role === 'meter')) return; if (variant === 'hold-close' && child.role === 'author1') releaseFirst = child.finish; else if (variant === 'hold-close' && child.role === 'meter') releaseMeter = child.finish; else queueMicrotask(child.finish); });
      children.push(child); events.push('spawn-' + role); budgetRefs.push(host.runBudget); identities.push(grant.enrollment.fingerprint);
      const emit = value => child.stdout.write(JSON.stringify(value) + '\n');
      const id = variant === 'reused-thread' ? 'same-thread' : 'thread-' + child.pid;
      const tool = (n, name, args) => ({id: n, method: 'item/tool/call', params: {threadId: id, turnId: 'turn-' + child.pid, callId: 'call-' + n, tool: name, arguments: args}});
      let buffer = '';
      child.stdin.on('data', data => { buffer += data; let at; while ((at = buffer.indexOf('\n')) >= 0) {
        const m = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1); frames.push({role: child.role, ...m});
        if (m.method === 'initialize') emit({id: m.id, result: {}});
        else if (m.method === 'account/read') {
          child.accountReads = (child.accountReads || 0) + 1;
          const value = account(); if ((variant === 'account' || (variant === 'account-before-turn' && child.accountReads === 2) || (variant === 'account-after-turn' && child.accountReads === 3)) && child.role === 'author2') value.workspaceRouting.chatgptAccountId = 'OTHER';
          emit({id: m.id, result: value});
        } else if (m.method === 'account/rateLimits/read') {
          if (variant === 'meter-cancel' && child.role === 'meter') { quotaWait = () => emit({id: m.id, result: usage()}); abort.abort(); continue; }
          const percent = child.role === 'author1' ? 25 : variant === 'budget' ? 35 : 30;
          const reading = usage(percent);
          if (variant === 'weekly-reset' && child.role === 'meter') reading.rateLimits.secondary.resetsAt += 604800;
          emit({id: m.id, result: reading});
        } else if (m.method === 'thread/start') emit({id: m.id, result: {thread: {id}, model: grant.selection.model, modelProvider: grant.selection.provider, reasoningEffort: variant === 'selection' && child.role === 'author2' ? 'low' : 'medium'}});
        else if (m.method === 'turn/start') child.stdout.write(JSON.stringify({id: m.id, result: {turn: {id: 'turn-' + child.pid}}}) + '\n' + JSON.stringify(tool(100, 'lonic_context', {})) + '\n');
        else if (m.method === 'turn/interrupt') emit({id: m.id, result: {}});
        else if (m.id === 100 && m.result) emit(tool(101, 'lonic_handoff', {status: child.role === 'author1' ? (variant === 'first-stop' ? 'stop' : variant === 'one-author' ? 'done' : 'continue') : variant === 'third' ? 'continue' : variant === 'second-stop' ? 'stop' : 'done', reason: 'EXAMPLE boundary', itemId: 'fixed-item', context: context()}));
        else if (m.id === 101 && m.result) emit({method: 'turn/completed', params: {threadId: id, turn: {id: 'turn-' + child.pid, status: 'completed'}}});
      }});
      return child;
    }
  };
  const options = {managed: true, signal: abort.signal, managedRun: grant};
  return {host, options, events, frames, children, budgetRefs, identities, abort, run: () => runQueue(options, {managed: host}),
    get releaseFirst() { return releaseFirst; }, get releaseMeter() { return releaseMeter; }, get quotaWait() { return quotaWait; }};
}
module.exports = {fixture, until, tick};
