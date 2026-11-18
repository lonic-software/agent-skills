'use strict';
const fs = require('node:fs');

function ownerInfo(file) {
  // A stale entry in a shared temporary directory may not be a regular lock.
  let fd;
  try {
    const entry = fs.lstatSync(file);
    if (!entry.isFile() || entry.nlink !== 1) return 'unavailable';
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY |
        (fs.constants.O_NOFOLLOW || 0) |
        (fs.constants.O_NONBLOCK || 0),
    );
    const stat = fs.fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.dev !== entry.dev ||
      stat.ino !== entry.ino ||
      (process.getuid && stat.uid !== process.getuid()) ||
      stat.size > 4096
    )
      return 'unavailable';
    const bytes = Buffer.alloc(4096);
    const n = fs.readSync(fd, bytes, 0, bytes.length, 0);
    return JSON.stringify(bytes.subarray(0, n).toString('utf8'));
  } catch {
    return 'unavailable';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
function acquireLock(file, owner) {
  try {
    fs.writeFileSync(file, owner, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    error.message =
      'Existing lock ' +
      file +
      '; owner metadata: ' +
      ownerInfo(file) +
      '. See codex/runtime/README.md#stale-lock-recovery before removing this lock.';
    throw error;
  }
}
module.exports = { acquireLock };
