'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const digest = (value) =>
  crypto.createHash('sha256').update(value).digest('hex');
const { checkedPath: plainPath } = require('./trusted-path.cjs');
function validate(data) {
  for (const key of [
    'runId',
    'itemId',
    'queue',
    'entrySkill',
    'authority',
    'resumePrompt',
  ])
    if (typeof data?.[key] !== 'string' || !data[key].trim())
      throw Error('Missing checkpoint field: ' + key);
  if (!['queue-run', 'powerup-auto', 'powerup'].includes(data.entrySkill))
    throw Error('Unknown continuation entry skill');
  if (!data.resumePrompt.startsWith('$' + data.entrySkill))
    throw Error('Resume prompt must invoke the recorded entry skill');
  for (const key of [
    'completedChecks',
    'openFindings',
    'blockedItems',
    'nextActions',
    'sourceState',
    'exclusions',
  ])
    if (!Array.isArray(data[key]))
      throw Error('Checkpoint field must be an array: ' + key);
  if (!data.nextActions.length)
    throw Error('A continuation needs explicit next actions');
  if (
    !data.budget ||
    data.budget.runId !== data.runId ||
    data.budget.schema !== 1
  )
    throw Error('Checkpoint must carry the matching run budget');
}
function readCheckpoint(file) {
  file = plainPath(file);
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    envelope.schema !== 1 ||
    typeof envelope.payload !== 'string' ||
    digest(envelope.payload) !== envelope.sha256
  )
    throw Error('Incomplete or corrupt checkpoint');
  const data = JSON.parse(envelope.payload);
  validate(data);
  return { data, sha256: envelope.sha256 };
}
function writeCheckpoint(directory, id, data) {
  validate(data);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id))
    throw Error('Invalid checkpoint ID');
  const root = plainPath(directory);
  fs.mkdirSync(root, { recursive: true });
  plainPath(root);
  const payload = JSON.stringify(data),
    envelope =
      JSON.stringify({ schema: 1, sha256: digest(payload), payload }, null, 2) +
      '\n';
  const file = path.join(root, id + '.json'),
    temp = path.join(root, '.' + id + '-' + crypto.randomUUID() + '.tmp');
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, envelope);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    // Linking publishes a complete file without replacing an earlier checkpoint.
    fs.linkSync(temp, file);
    const saved = readCheckpoint(file);
    if (saved.sha256 !== digest(payload))
      throw Error('Checkpoint readback mismatch');
    return { file, sha256: saved.sha256 };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try {
      fs.unlinkSync(temp);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
}
function claimCheckpoint(file, expectedHash, consumerId) {
  if (typeof consumerId !== 'string' || !consumerId.trim())
    throw Error('Consumer identity is required');
  file = plainPath(file);
  const saved = readCheckpoint(file);
  if (saved.sha256 !== expectedHash)
    throw Error('Checkpoint changed before continuation');
  const claim = file + '.claimed';
  plainPath(claim);
  // An interrupted consumer leaves its claim behind. Recovery must reconcile it;
  // deleting a claim automatically could start the same queued work twice.
  const fd = fs.openSync(claim, 'wx', 0o600);
  try {
    fs.writeFileSync(
      fd,
      JSON.stringify({
        schema: 1,
        checkpointHash: expectedHash,
        consumerId,
        claimedAt: new Date().toISOString(),
      }) + '\n',
    );
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return { data: saved.data, claim };
}
module.exports = {
  writeCheckpoint,
  readCheckpoint,
  claimCheckpoint,
  plainPath,
};
