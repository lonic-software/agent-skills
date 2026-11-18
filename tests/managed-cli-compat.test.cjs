'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {tomlValue} = require('../codex/runtime/managed-host.cjs');
test('queue CLI without managed flag is identical to its original branch', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../codex/runtime/queue.cjs'), 'utf8');
  const baseline = source.replace(/^ if\(argv\.includes\('--managed'\)\)return require\('\.\/managed-cli\.cjs'\)\.main\(argv\);\r?\n/m, '');
  assert.notEqual(source, baseline);
  async function run(text, managed) {
    const calls = [], module = {exports: {}}, reads = [];
    const require = name => name === 'node:fs' ? {readFileSync(file) { reads.push(file); return file === 'config' ? JSON.stringify({schema: 1, codex: 'EXAMPLE', model: 'EXAMPLE'}) : 'EXAMPLE authority'; }} : name === './queue-controller.cjs' ? {runQueue: async options => { calls.push(JSON.parse(JSON.stringify(options))); return {status: 'complete'}; }} : name === './operator.cjs' ? {terminalAsk() { throw Error('Unexpected terminal'); }} : name === './managed-cli.cjs' ? {main: async argv => { calls.push(argv); return 2; }} : null;
    vm.runInNewContext(text, {module, require, process: {on() {}, removeListener() {}}, console: {log() {}}, AbortController});
    const argv = ['--config', 'config', '--project', 'EXAMPLE', '--queue', 'task', '--authority-file', 'authority', '--threshold', '50'];
    if (managed) argv.unshift('--managed');
    return {code: await module.exports.main(argv), calls, reads};
  }
  assert.deepEqual(await run(source, false), await run(baseline, false));
  const managed = await run(source, true); assert.equal(managed.code, 2); assert.deepEqual(managed.reads, []);
});
test('skill-disable flags use TOML inline tables, not JSON object syntax', () => {
  assert.equal(tomlValue([{path: 'C:/EXAMPLE/SKILL.md', enabled: false}]), '[{"path"="C:/EXAMPLE/SKILL.md","enabled"=false}]');
});
