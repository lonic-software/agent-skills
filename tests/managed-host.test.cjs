'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {PassThrough} = require('node:stream');
const {hostFixture} = require('./fixtures/managed-host-fixture.cjs');
const {enrollManagedAccount, terminalEnrollment} = require('../codex/runtime/managed-enrollment.cjs');
const {main, parse} = require('../codex/runtime/managed-cli.cjs');
const {verifyResult} = require('../codex/runtime/managed-result.cjs');
async function enroll(f) {
  const host = f.createHost(); let prompt;
  await enrollManagedAccount(host, {inputTTY: true, outputTTY: true, confirm: async text => { prompt = text; return 'yes'; }});
  assert.match(prompt, /PRIVATE-user@example.invalid/);
  const stored = fs.readFileSync(host.enrollmentPath, 'utf8'); assert.doesNotMatch(stored, /PRIVATE-|email|token/);
  assert.deepEqual(Object.keys(JSON.parse(stored)).sort(), ['algorithm', 'fingerprint', 'schema']);
}
test('S21 enrollment preserves a safe inventory rule and leaves a settled journal', {skip: process.platform !== 'win32'}, async()=>hostFixture(async f=>{
  const host=f.createHost();let prompts=0;
  await assert.rejects(enrollManagedAccount(host,{inputTTY:true,outputTTY:true,confirm:async()=>{prompts++;return 'yes';}}),e=>e.ruleId==='HOOK_DISABLED'&&e.code==='MANAGED_ADMISSION_REFUSED'&&e.recoveryRequired===false);
  assert.equal(prompts,0);const state=JSON.parse(fs.readFileSync(path.join(path.dirname(host.enrollmentPath),'intent.json'),'utf8'));assert.equal(state.status,'settled');assert.ok(state.intents.every(i=>i.status==='settled'));
},'hook'));
test('explicit reenrollment retains old approval until confirmed and stores fingerprint-only archive', {skip: process.platform !== 'win32'}, async () => hostFixture(async f => {
  await enroll(f); const host = f.createHost(), next = fs.readFileSync(host.enrollmentPath, 'utf8');
  fs.writeFileSync(host.enrollmentPath, JSON.stringify({...JSON.parse(next), fingerprint: '0'.repeat(64)}) + '\n');
  const before = fs.readFileSync(host.enrollmentPath, 'utf8'); let questions = 0;
  await enrollManagedAccount(host, {inputTTY: true, outputTTY: true, confirm: async text => { questions++; return text.includes('REENROLL') ? 'REENROLL' : 'yes'; }}, {replace: true});
  assert.equal(questions, 2); assert.notEqual(next, before); assert.equal(fs.readFileSync(host.enrollmentPath, 'utf8'), next);
  const dir = path.dirname(host.enrollmentPath), archives = fs.readdirSync(dir).filter(x => x.startsWith('enrollment.json.') && x.endsWith('.previous.json'));
  assert.equal(archives.length, 1); assert.equal(fs.readFileSync(path.join(dir, archives[0]), 'utf8'), before);
  const journal = JSON.parse(fs.readFileSync(path.join(dir, 'intent.json'), 'utf8')); assert.equal(journal.status, 'settled'); assert.ok(journal.owner.created); assert.ok(journal.intents.every(i => i.identities?.length));
}));
for (const failure of ['declined-label', 'changed-second-sample']) test('reenrollment preserves the old pin after ' + failure, {skip: process.platform !== 'win32'}, async () => hostFixture(async f => {
  await enroll(f); const actual = f.createHost(), before = fs.readFileSync(actual.enrollmentPath, 'utf8'); let samples = 0;
  const host = {...actual, async readEnrollmentSample() {
    const sample = await actual.readEnrollmentSample();
    if (++samples === 2 && failure === 'changed-second-sample') { sample.account.workspaceRouting.chatgptAccountId = 'PRIVATE-CHANGED'; sample.usage.accountId = 'PRIVATE-CHANGED'; }
    return sample;
  }};
  await assert.rejects(enrollManagedAccount(host, {inputTTY: true, outputTTY: true, confirm: async text => text.includes('REENROLL') ? 'REENROLL' : failure === 'declined-label' ? 'no' : 'yes'}, {replace: true}), /MANAGED_ENROLLMENT_FAILED/);
  assert.equal(fs.readFileSync(actual.enrollmentPath, 'utf8'), before);
  assert.equal(fs.readdirSync(path.dirname(actual.enrollmentPath)).filter(x => x.startsWith('enrollment.json.') && x.endsWith('.previous.json')).length, 0);
}));
test('real host adapters plus managed CLI run own Node doubles and deliver clean incomplete bytes', {skip: process.platform !== 'win32'}, async () => hostFixture(async f => {
  await enroll(f);
  const runtime = path.join(f.root, 'runtime.json'), authority = path.join(f.root, 'authority.txt');
  fs.writeFileSync(runtime, JSON.stringify({schema: 1, codex: process.execPath, model: 'gpt-6.1-sol'})); fs.writeFileSync(authority, 'EXAMPLE bounded task');
  const stdout = new PassThrough(), stderr = new PassThrough(); let bytes = Buffer.alloc(0), diagnostic = '';
  stdout.on('data', b => { bytes = Buffer.concat([bytes, b]); }); stderr.on('data', b => { diagnostic += b; });
  const code = await main(['--managed', '--config', runtime, '--project', f.project, '--profile', f.profile, '--state-root', f.stateRoot, '--queue-kind', 'file', '--queue', 'task.md', '--authority-file', authority, '--threshold', '60', '--timeout-ms', '60000'], {stdout, stderr, createHost: cfg => f.createHost(cfg)});
  assert.equal(code, 2, diagnostic); assert.equal(JSON.parse(bytes).context.summary, 'EXAMPLE handoff preserved');
  const status = JSON.parse(diagnostic.trim().split('\n').at(-1)); assert.equal(status.status, 'incomplete'); assert.equal(status.recoveryRequired, false); assert.equal(verifyResult(bytes, status.receipt), true);
  assert.doesNotMatch(diagnostic + bytes.toString(), /PRIVATE-|fingerprint/);
  assert.equal(f.methods.filter(m => m === 'turn/start').length, 2); assert.equal(f.methods.filter(m => m === 'thread/start').length, 2);
  assert.ok(f.methods.includes('config/read')); assert.ok(f.methods.includes('hooks/list')); assert.ok(f.methods.includes('skills/list'));
  assert.ok(f.owned.every(o => o.closed)); assert.ok(f.settings.every(args => !args.some(a => a.startsWith('model_providers.openai'))));
}));
for (const scenario of ['hook', 'thread-hook', 'unknown-source']) test('real host refuses ' + scenario + ' before any model turn', {skip: process.platform !== 'win32'}, async () => hostFixture(async f => {
  // Seed only a synthetic fixture fingerprint; no real operator/account exists.
  const {accountFingerprint} = require('../codex/runtime/managed-admission.cjs');
  const host = f.createHost(); host.storeEnrollment({schema: 1, algorithm: 'm2-account-v1', fingerprint: accountFingerprint({account: {type: 'chatgpt'}, workspaceRouting: {chatgptAccountId: 'PRIVATE-ID', backendOrigin: 'PRIVATE-ORIGIN'}}, {accountId: 'PRIVATE-ID'})});
  try {
    if (scenario === 'hook') await assert.rejects(host.prepare(), e=>e.ruleId==='HOOK_DISABLED'&&e.recoveryRequired===false);
    else {
      const grant = await host.prepare(); const {runQueue} = require('../codex/runtime/queue-controller.cjs');
      const result = await runQueue({managed: true, managedRun: grant, signal: host.signal}, {managed: host.host}); assert.equal(result.status, 'refused'); assert.equal(result.recoveryRequired,false);
    }
    assert.equal(f.methods.includes('turn/start'), false);
    const state=JSON.parse(fs.readFileSync(path.join(path.dirname(host.enrollmentPath),'intent.json'),'utf8'));assert.equal(state.status,'settled');assert.ok(state.intents.every(i=>i.status==='settled'));
  } finally { await host.dispose(); }
}, scenario));
test('CLI refuses missing kind/explicit timeout and enrollment requires a terminal before host access', async () => {
  const base = ['--managed', '--config', 'config', '--project', 'project', '--profile', 'profile', '--state-root', 'state'];
  assert.throws(() => parse(base), /ARGUMENT_REQUIRED/);
  assert.throws(() => parse([...base, '--queue-kind', 'tracker', '--queue', 'x', '--authority-file', 'a', '--timeout-ms', '1000', '--threshold', '50']), /ARGUMENT_REQUIRED/);
  assert.throws(() => terminalEnrollment({isTTY: false}, {isTTY: true}), /INTERACTIVE_TERMINAL_REQUIRED/);
  const stderr = new PassThrough(); stderr.resume(); let hosts = 0;
  assert.equal(await main([...base, '--enroll'], {stdin: {isTTY: false}, stderr, createHost: () => { hosts++; }}), 1); assert.equal(hosts, 0);
});
test('run-local profile drift after preparation prevents author launch', {skip: process.platform !== 'win32'}, async () => hostFixture(async f => {
  await enroll(f); const host = f.createHost();
  try {
    const grant = await host.prepare(); fs.writeFileSync(path.join(f.profile, 'config.toml'), '# CHANGED fixture\n');
    const {runQueue} = require('../codex/runtime/queue-controller.cjs');
    const result = await runQueue({managed: true, managedRun: grant, signal: host.signal}, {managed: host.host});
    assert.equal(result.status, 'needs-reconciliation'); assert.equal(f.methods.includes('turn/start'), false);
  } finally { await host.dispose(); }
}));
