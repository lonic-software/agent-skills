'use strict';
const fs = require('node:fs'), path = require('node:path'), {createHash} = require('node:crypto');
function createProfileGuard(profile, {io = fs, audit = () => {}} = {}) {
  const root = io.realpathSync(profile);
  if (root !== path.resolve(profile) || io.lstatSync(profile).isSymbolicLink()) throw Error('MANAGED_PROFILE_UNCERTAIN');
  function stat(name) {
    const file = path.join(root, name), s = io.lstatSync(file);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || io.realpathSync(file) !== file) throw Error('MANAGED_PROFILE_UNCERTAIN');
    return {size: s.size, mtimeMs: s.mtimeMs};
  }
  function capture() {
    if (io.realpathSync(profile) !== root) throw Error('MANAGED_PROFILE_UNCERTAIN');
    const before = stat('config.toml');
    const config = io.readFileSync(path.join(root, 'config.toml'));
    const after = stat('config.toml');
    if (JSON.stringify(before) !== JSON.stringify(after) || config.length !== after.size) throw Error('MANAGED_PROFILE_UNCERTAIN');
    // auth.json is metadata-only: never read/open/hash its content.
    return {config: {size: config.length, sha256: createHash('sha256').update(config).digest('hex')}, auth: stat('auth.json')};
  }
  const baseline = capture();
  audit({event: 'profile-baseline', ...JSON.parse(JSON.stringify(baseline))});
  let stopped = false;
  return Object.freeze({
    verify() {
      if (stopped) return false;
      try { stopped = JSON.stringify(capture()) !== JSON.stringify(baseline); } catch { stopped = true; }
      return !stopped;
    },
    baseline: () => JSON.parse(JSON.stringify(baseline))
  });
}
module.exports = {createProfileGuard};
