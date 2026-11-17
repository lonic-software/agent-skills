'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw Error('MANAGED_INPUTS_UNCERTAIN'); };

// Synchronous final capture: the dispatching caller must not await between
// verify() and turn/start. No profile is opened here; its run-local guard is a
// mandatory trusted callback. Instruction enumeration must cover effective
// membership, including ignored/host/skill inputs, not merely known paths.
function createManagedInputs({cwd, task, enumerateInstructions, verifyProfile, env = process.env}) {
  if (!path.isAbsolute(cwd) || task?.kind !== 'file' || typeof task.locator !== 'string' || typeof enumerateInstructions !== 'function' || typeof verifyProfile !== 'function') fail();
  const {cleanGitEnvironment} = require('./managed-git-env.cjs');
  const cleanedEnv = cleanGitEnvironment(env);
  const root = fs.realpathSync(cwd);
  if (path.resolve(cwd) !== root) fail();
  const inside = p => { const r = path.relative(root, p); return r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r); };
  function bytes(file, allowMissing = false) {
    if (!inside(file)) fail();
    // A missing leaf behind a junction/symlink is not an ordinary deletion.
    // Inspect existing components even when the final pathname is absent.
    let component = root;
    for (const part of path.relative(root, file).split(path.sep)) {
      component = path.join(component, part);
      try { if (fs.lstatSync(component).isSymbolicLink()) fail(); }
      catch (error) { if (error.code === 'ENOENT') break; throw error; }
    }
    let stat;
    try { stat = fs.lstatSync(file, {bigint: true}); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') return null; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || fs.realpathSync(file) !== path.resolve(file)) fail();
    const data = fs.readFileSync(file), after = fs.lstatSync(file, {bigint: true});
    if (stat.ino !== after.ino || stat.size !== after.size || stat.mtimeNs !== after.mtimeNs || stat.ctimeNs !== after.ctimeNs) fail();
    return {identity: String(stat.dev) + ':' + String(stat.ino), length: data.length, sha256: hash(data)};
  }
  const gitEnv = {...cleanedEnv, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null'};
  const git = args => execFileSync('git', ['-C', root, ...args], {env: gitEnv, windowsHide: true, maxBuffer: 16 * 1024 * 1024});
  function captureOnce() {
    if (verifyProfile() !== true) fail();
    // Reject redirected git/common directories and every outward namespace.
    const config = path.join(root, '.git', 'config');
    const configState = bytes(config), headState = bytes(path.join(root, '.git', 'HEAD'));
    if (fs.existsSync(path.join(root, '.git', 'config.worktree'))) fail();
    if (/^\s*\[\s*(include|includeIf|extensions)\b/im.test(fs.readFileSync(config, 'utf8'))) fail();
    const gitDir = path.resolve(root, git(['rev-parse', '--git-dir']).toString().trim());
    const common = path.resolve(root, git(['rev-parse', '--git-common-dir']).toString().trim());
    if (gitDir !== path.join(root, '.git') || common !== gitDir || fs.realpathSync(gitDir) !== gitDir) fail();
    if (path.resolve(git(['rev-parse', '--show-toplevel']).toString().trim()) !== root) fail();
    const index = bytes(path.join(gitDir, 'index'), true);
    const head = git(['rev-parse', '--verify', 'HEAD']).toString().trim();
    const names = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString('utf8').split('\0').filter(Boolean))].sort();
    if (names.length > 10000) fail();
    const files = names.map(name => [name, bytes(path.resolve(root, name), true)]);
    const instructionInventory = enumerateInstructions();
    if (instructionInventory?.complete !== true || !Array.isArray(instructionInventory.sources) || !instructionInventory.sources.length) fail();
    const seen = new Set();
    const sources = instructionInventory.sources.map(source => {
      if (typeof source.key !== 'string' || !source.key || seen.has(source.key)) fail(); seen.add(source.key);
      if (source.path) return [source.key, path.resolve(source.path), bytes(path.resolve(source.path))];
      if (typeof source.content !== 'string' || typeof source.identity !== 'string') fail();
      return [source.key, source.identity, hash(Buffer.from(source.content))];
    }).sort((a, b) => a[0].localeCompare(b[0]));
    const result = {head, headState, configState, index, files, task: bytes(path.resolve(root, task.locator)), sources};
    if (JSON.stringify(index) !== JSON.stringify(bytes(path.join(gitDir, 'index'), true)) || verifyProfile() !== true) fail();
    return result;
  }
  function capture() {
    const first = captureOnce(), second = captureOnce();
    if (JSON.stringify(first) !== JSON.stringify(second)) fail();
    return first;
  }
  let baseline = capture(), pending = null;
  const pinnedSources = JSON.stringify(baseline.sources);
  return Object.freeze({
    verify(boundary) {
      try {
        const next = capture();
        if (JSON.stringify(next.sources) !== pinnedSources) return false;
        if (boundary === 'after-exit') { pending = next; return true; }
        return JSON.stringify(next) === JSON.stringify(baseline);
      } catch { return false; }
    },
    acceptHandoff() {
      try {
        if (!pending) return false;
        const next = capture();
        if (JSON.stringify(next) !== JSON.stringify(pending) || JSON.stringify(next.sources) !== pinnedSources) return false;
        baseline = next; pending = null; return true;
      } catch { return false; }
    }
  });
}
module.exports = {createManagedInputs};
