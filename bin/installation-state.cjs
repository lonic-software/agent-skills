'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { checkedPath } = require('../codex/runtime/trusted-path.cjs');

function metadataDir(scope, root) {
  return checkedPath(
    path.join(root, scope === 'global' ? 'lonic' : '.codex/lonic'),
  );
}
function inventoryRelative(scope) {
  return scope === 'global'
    ? 'lonic/install-receipt.json'
    : '.codex/lonic/install-receipt.json';
}
function safeRelative(scope, relative) {
  if (
    typeof relative !== 'string' ||
    relative.includes('\\') ||
    /[:\x00-\x1f]/.test(relative) ||
    relative
      .split('/')
      .some(
        (part) =>
          !part ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    return false;
  return (
    scope === 'global'
      ? /^(skills\/[a-z0-9-]+\/|agents\/[a-z0-9-]+\.toml$|lonic\/runtime\/|lonic\/runtime-config\.example\.json$)/
      : /^(\.agents\/skills\/[a-z0-9-]+\/|\.codex\/agents\/[a-z0-9-]+\.toml$|\.codex\/lonic\/runtime\/|\.codex\/lonic\/runtime-config\.example\.json$)/
  ).test(relative);
}
function readInventory(scope, root, requiredSelection) {
  const file = checkedPath(path.join(root, inventoryRelative(scope)));
  const bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
  const state = bytes
    ? JSON.parse(bytes)
    : { schema: 1, scope, root, files: [] };
  if (
    state.schema !== 1 ||
    state.scope !== scope ||
    state.root !== root ||
    !Array.isArray(state.files)
  )
    throw Error('Installation receipt does not match scope and root: ' + file);
  const names = new Set();
  for (const row of state.files) {
    if (
      !safeRelative(scope, row.path) ||
      names.has(row.path.toLowerCase()) ||
      !/^[a-f0-9]{64}$/.test(row.sha256) ||
      !Array.isArray(row.owners) ||
      !row.owners.length ||
      row.owners.some(
        (name) => typeof name !== 'string' || !/^[a-z0-9-]+$/.test(name),
      )
    )
      throw Error('Invalid installation receipt entry: ' + file);
    names.add(row.path.toLowerCase());
  }
  if (
    requiredSelection &&
    !state.files.some((row) => row.owners.includes(requiredSelection))
  )
    throw Error(
      'No installation receipt for ' +
        requiredSelection +
        ' at ' +
        file +
        '. Back up local edits. Use this installer with the exact package files from the originally installed revision, review --check, then --apply the same selection and scope to record matching files. Restore the new package before planning update or remove.',
    );
  return { state, file, bytes };
}
function nextInventory(state, selection, files) {
  const rows = new Map();
  for (const row of state.files) {
    const owners = row.owners.filter((owner) => owner !== selection);
    if (owners.length) rows.set(row.path, { ...row, owners });
  }
  for (const file of files) {
    const name = file.relative.split(path.sep).join('/');
    if (!safeRelative(state.scope, name))
      throw Error('Invalid installation path: ' + name);
    const owners = [...(rows.get(name)?.owners || []), selection].sort();
    rows.set(name, { path: name, sha256: file.sha256, owners });
  }
  const sorted = [...rows.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return Buffer.from(
    JSON.stringify({ ...state, files: sorted }, null, 2) + '\n',
  );
}
function writeInventory(inventory, bytes) {
  if (inventory.bytes?.equals(bytes)) return;
  const temp = inventory.file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
    checkedPath(inventory.file);
    fs.renameSync(temp, inventory.file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
function takeLock(scope, root, owner) {
  const dir = metadataDir(scope, root);
  fs.mkdirSync(dir, { recursive: true });
  const lock = checkedPath(path.join(dir, 'update.lock'));
  require('../codex/runtime/lock.cjs').acquireLock(lock, owner);
  return () => {
    try {
      if (fs.readFileSync(lock, 'utf8') === owner) fs.unlinkSync(lock);
    } catch {
      /* A retained lock can be reconciled manually. */
    }
  };
}
module.exports = {
  inventoryRelative,
  readInventory,
  nextInventory,
  writeInventory,
  takeLock,
  safeRelative,
};
