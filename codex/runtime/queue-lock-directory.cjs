'use strict';
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const path = require('node:path');
const { tempRoot } = require('./trusted-path.cjs');

function checkedDirectory(dir, uid) {
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const stat = fs.lstatSync(dir);
  let reason;
  if (stat.isSymbolicLink()) reason = 'is a symbolic link';
  else if (!stat.isDirectory()) reason = 'is not a directory';
  else if (uid !== null && stat.uid !== uid)
    reason = 'is owned by uid ' + stat.uid + ', expected ' + uid;
  else if (uid !== null && stat.mode & 0o022)
    reason = 'is writable by group or others';
  if (reason) throw Error('Unsafe queue lock directory: ' + dir + ' ' + reason);
}

function queueLockDirectory(temp = tempRoot.real) {
  // Windows uses a per-user temp directory and ACLs, not POSIX ownership.
  const uid = process.platform === 'win32' ? null : process.getuid();
  // Hash the OS account identity so no part of it is interpreted as a path.
  let account = uid;
  if (uid === null) {
    const { username, homedir } = os.userInfo();
    account = crypto
      .createHash('sha256')
      .update(JSON.stringify([username.toLowerCase(), homedir.toLowerCase()]))
      .digest('hex');
  }
  const parent = path.join(temp, 'lonic-codex-' + account);
  checkedDirectory(parent, uid);
  const dir = path.join(parent, 'queue-locks');
  checkedDirectory(dir, uid);
  return dir;
}

module.exports = { queueLockDirectory };
