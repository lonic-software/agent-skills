'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');
const {projectState} = require('../../codex/runtime/managed-storage.cjs');
const {createWindowsGateAdapter} = require('../../codex/runtime/managed-windows-gate.cjs');
const {createManagedHost} = require('../../codex/runtime/managed-host.cjs');
async function hostFixture(action, scenario = 'normal') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-host-')), project = path.join(root, 'project'), profile = path.join(root, 'profile'), stateRoot = path.join(root, 'state');
  fs.mkdirSync(project); fs.mkdirSync(profile); fs.writeFileSync(path.join(profile, 'config.toml'), '# EXAMPLE fixture\n'); fs.writeFileSync(path.join(profile, 'auth.json'), 'PRIVATE-auth-content-never-read');
  fs.writeFileSync(path.join(project, 'AGENTS.md'), 'EXAMPLE project instruction'); fs.writeFileSync(path.join(project, 'task.md'), 'EXAMPLE task');
  const gitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
  const git = args => execFileSync('git', ['-C', project, '-c', 'core.hooksPath=' + path.join(root, 'no-hooks'), '-c', 'commit.gpgsign=false', ...args], {env: {...gitEnvironment, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null'}, windowsHide: true, stdio: 'pipe'});
  git(['init']); git(['config', 'user.name', 'EXAMPLE']); git(['config', 'user.email', 'fixture@example.invalid']); git(['add', '.']); git(['commit', '-m', 'EXAMPLE fixture']);
  const owned = [], methods = [], settings = []; let serial = 0;
  function retain(child) {
    const record = {child, row: {pid: child.pid, parentPid: process.pid, created: String(100 + owned.length)}, closed: false}; owned.push(record);
    child.once('close', () => { record.closed = true; });
    return child;
  }
  const backend = {prepare: async () => {}, observe: async () => ({complete: true, processes: [{pid: process.pid, parentPid: 0, created: '10'}, ...owned.filter(o => !o.closed && o.child.exitCode === null && o.child.signalCode === null).map(o => o.row)]}), signal: async target => {
    const record = owned.find(o => o.row.pid === target.pid && o.row.created === target.created); if (!record) throw Error('NOT_OWN_CHILD');
    if (record.closed || record.child.exitCode !== null || record.child.signalCode !== null) return {verified: true, status: 'gone'};
    record.child.kill(); return {verified: true, status: 'signalled'};
  }};
  const cfg = {project, profile, stateRoot, codex: process.execPath, model: 'gpt-6.2-sol', effort: 'medium', task: {kind: 'file', locator: path.join(project, 'task.md'), itemId: 'fixed-item'}, authority: 'EXAMPLE no project edits', exclusions: [], budget: {relative: 10}, timeoutMs: 60000, gitEnvironment};
  function createHost(config = cfg) {
    const state = projectState(stateRoot, project);
    const gateAdapter = createWindowsGateAdapter({mode: 'managed', gatePath: state.gatePath, timeoutMs: 10000, adapters: {tree: backend, checkPolicy: async () => ({allowed: true, policy: 'RemoteSigned'}), spawnHelper: () => retain(spawn(process.execPath, [path.join(__dirname, 'managed-node-stub.cjs'), 'gate-protocol', 'EXAMPLE-host'], {windowsHide: true, detached: true, stdio: ['pipe', 'pipe', 'pipe']}))}});
    return createManagedHost({...cfg, ...config}, {backend, gateAdapter, spawnChild: (exe, args, opts) => {
      if (Object.keys(opts.env).sort().join(',') !== ['CODEX_HOME', 'SystemRoot', 'TEMP', 'TMP'].sort().join(',')) throw Error('ENV_OVERLAY');
      settings.push(args); if (args.some(a => a.startsWith('skills.config='))) serial++;
      const child = retain(spawn(process.execPath, [path.join(__dirname, 'managed-host-stub.cjs'), scenario, String(serial)], {...opts, detached: true}));
      const write = child.stdin.write.bind(child.stdin);
      child.stdin.write = (bytes, ...rest) => { try { const request = JSON.parse(String(bytes)); if (request.method) methods.push(request.method); } catch {} return write(bytes, ...rest); };
      return child;
    }});
  }
  try { await action({root, project, profile, stateRoot, cfg, createHost, owned, methods, settings}); }
  finally {
    for (const o of owned) if (!o.closed) o.child.stdin.end();
    await Promise.all(owned.filter(o => !o.closed).map(o => new Promise(resolve => o.child.once('close', resolve))));
    if (fs.realpathSync(root) !== path.resolve(root) || path.dirname(root) !== fs.realpathSync(os.tmpdir())) throw Error('FIXTURE_PATH_UNCERTAIN');
    fs.rmSync(root, {recursive: true, force: true});
  }
}
module.exports = {hostFixture};
