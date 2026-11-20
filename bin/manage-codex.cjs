#!/usr/bin/env node
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const {
  readInventory,
  nextInventory,
  inventoryRelative,
  takeLock,
  safeRelative,
} = require('./installation-state.cjs');
const { plan, destination } = require('./install-codex.cjs');
const { plainPath } = require('../codex/runtime/queue-checkpoint.cjs');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const current = (file) => {
  plainPath(file);
  if (!fs.existsSync(file)) return null;
  if (!fs.statSync(file).isFile()) throw Error('Not a regular file: ' + file);
  return fs.readFileSync(file);
};
const hash = (bytes) => (bytes === null ? null : sha(bytes));
function payload(relative, before, after) {
  return {
    relative,
    before: before?.toString('base64') ?? null,
    beforeSha: hash(before),
    after: after?.toString('base64') ?? null,
    afterSha: hash(after),
  };
}
function savePlan(repo, project, selection, file, options = {}) {
  if (typeof selection !== 'string' || !/^[a-z0-9-]+$/.test(selection))
    throw Error('Invalid installation selection');
  const dest = destination(project, options);
  const inventory = readInventory(dest.scope, dest.project, selection);
  const selected = options.remove
    ? { ...dest, files: [], duplicates: [], collisionTargets: [] }
    : plan(repo, project, selection, options);
  project = selected.project;
  if (
    selected.duplicates.length &&
    options.onDuplicate !== 'keep-both' &&
    !options.remove
  )
    throw Error(
      'Cross-scope skill collision: choose a scope or --on-duplicate keep-both',
    );
  file = plainPath(file);
  if (fs.existsSync(file)) throw Error('Plan already exists');
  const desired = new Map(
    selected.files.map((f) => [f.relative.split(path.sep).join('/'), f]),
  );
  const names = new Set([...desired.keys()]);
  const owned = new Map(inventory.state.files.map((row) => [row.path, row]));
  for (const row of owned.values())
    if (row.owners.includes(selection)) names.add(row.path);
  const files = [],
    guards = [];
  for (const name of names) {
    const target = plainPath(path.join(project, name));
    if (target === file)
      throw Error('Plan must not replace an installation target');
    const row = owned.get(name),
      proposed = desired.get(name);
    if (!proposed && row.owners.some((owner) => owner !== selection)) continue;
    const before = current(target),
      after = proposed?.bytes ?? null;
    if (!proposed && before && hash(before) !== row.sha256)
      throw Error(
        'Removal refuses edited files: ' +
          target +
          '. Preserve or restore the installed version before removal.',
      );
    const entry = payload(name, before, after);
    if (entry.beforeSha === entry.afterSha)
      guards.push({ relative: name, sha256: entry.beforeSha });
    else files.push(entry);
  }
  if (file === inventory.file)
    throw Error('Plan must not replace the installation receipt');
  const installation = payload(
    inventoryRelative(selected.scope),
    inventory.bytes,
    nextInventory(inventory.state, selection, selected.files),
  );
  const data = {
    schema: 2,
    installation,
    guards,
    scope: selected.scope,
    project: path.resolve(project),
    selection,
    operation: options.remove ? 'remove' : 'update',
    collisionTargets: selected.collisionTargets,
    onDuplicate: options.onDuplicate || null,
    createdAt: new Date().toISOString(),
    files,
  };
  const bytes = Buffer.from(JSON.stringify(data, null, 2) + '\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  plainPath(file);
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  return {
    file,
    sha256: sha(bytes),
    scope: data.scope,
    project: data.project,
    files: files.map((f) => ({
      path: f.relative,
      before: f.beforeSha,
      after: f.afterSha,
    })),
  };
}
function loadPlan(file, expected) {
  file = plainPath(file);
  const bytes = fs.readFileSync(file);
  if (!/^[a-f0-9]{64}$/.test(expected || '') || sha(bytes) !== expected)
    throw Error('Plan digest differs from the approved SHA-256');
  const data = JSON.parse(bytes);
  if (data.schema === 1)
    throw Error(
      'Legacy plan has no installation receipt. Prepare a new plan with the current installer.',
    );
  if (
    data.schema !== 2 ||
    !data.installation ||
    data.installation.relative !== inventoryRelative(data.scope) ||
    !Array.isArray(data.guards) ||
    !['global', 'project'].includes(data.scope) ||
    !path.isAbsolute(data.project) ||
    !Array.isArray(data.files)
  )
    throw Error('Invalid update plan');
  plainPath(data.project);
  const seen = new Set();
  const guards = new Set(data.guards);
  for (const f of [...data.files, ...data.guards, data.installation]) {
    if (typeof f.relative !== 'string' || path.isAbsolute(f.relative))
      throw Error('Invalid target');
    const relative = f.relative;
    const agentPrefix = data.scope === 'global' ? 'agents/' : '.codex/agents/';
    const foreignAgent =
      relative.startsWith(agentPrefix) &&
      !relative.startsWith(agentPrefix + 'lonic-');
    if (
      f !== data.installation &&
      (!safeRelative(data.scope, relative) || foreignAgent)
    )
      throw Error('Target outside the Codex package: ' + relative);
    const key = relative.toLowerCase();
    if (seen.has(key)) throw Error('Duplicate target');
    seen.add(key);
    f.target = plainPath(path.join(data.project, f.relative));
    if (guards.has(f)) continue;
    f.beforeBytes = f.before === null ? null : Buffer.from(f.before, 'base64');
    f.afterBytes = f.after === null ? null : Buffer.from(f.after, 'base64');
    if (
      hash(f.beforeBytes) !== f.beforeSha ||
      hash(f.afterBytes) !== f.afterSha
    )
      throw Error('Plan payload is corrupt');
  }
  return { file, data, digest: expected };
}
function replace(file, bytes, expected, onMutation = () => {}) {
  if (hash(current(file)) !== expected)
    throw Error('File changed since preview: ' + file);
  if (bytes === null) {
    fs.unlinkSync(file);
    onMutation();
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  plainPath(file);
  const temp = file + '.lonic-' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
    if (hash(current(file)) !== expected)
      throw Error('File changed during update: ' + file);
    fs.renameSync(temp, file);
    onMutation();
    if (hash(current(file)) !== sha(bytes))
      throw Error('Update readback failed');
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
function transact(file, approved, { rollback = false } = {}) {
  const saved = loadPlan(file, approved),
    { data } = saved,
    receipt = file + '.applied.json';
  if (
    !rollback &&
    data.operation !== 'remove' &&
    data.onDuplicate !== 'keep-both' &&
    (data.collisionTargets || []).some((p) => {
      plainPath(p);
      return fs.existsSync(p);
    })
  )
    throw Error(
      'Cross-scope skill collision appeared; prepare a new plan with an explicit decision',
    );
  if (rollback) {
    const applied = JSON.parse(fs.readFileSync(receipt, 'utf8'));
    if (applied.sha256 !== approved || applied.status !== 'applied')
      throw Error('No matching completed update to roll back');
  } else if (fs.existsSync(receipt))
    throw Error(
      'This plan already has an application record; inspect it before recovery',
    );
  const release = takeLock(
    data.scope,
    data.project,
    JSON.stringify({
      pid: process.pid,
      operation: rollback ? 'rollback' : data.operation,
      sha256: approved,
    }),
  );
  const changed = [];
  let result;
  try {
    for (const g of data.guards)
      if (hash(current(g.target)) !== g.sha256)
        throw Error('File changed since the approved plan: ' + g.target);
    for (const f of [...data.files, data.installation])
      if (hash(current(f.target)) !== (rollback ? f.afterSha : f.beforeSha))
        throw Error('File changed since the approved plan: ' + f.target);
    if (!rollback)
      fs.writeFileSync(
        receipt,
        JSON.stringify({ sha256: approved, status: 'applying' }) + '\n',
        { flag: 'wx', mode: 0o600 },
      );
    const ordered = rollback ? [...data.files].reverse() : [...data.files];
    if (data.installation.beforeSha !== data.installation.afterSha)
      ordered.push(data.installation);
    for (const f of ordered)
      replace(
        f.target,
        rollback ? f.beforeBytes : f.afterBytes,
        rollback ? f.afterSha : f.beforeSha,
        () => changed.push(f),
      );
    result = {
      sha256: approved,
      status: rollback ? 'rolled-back' : 'applied',
      completedAt: new Date().toISOString(),
      files: changed.map((f) => f.relative),
    };
    fs.writeFileSync(receipt, JSON.stringify(result, null, 2) + '\n');
    return result;
  } catch (error) {
    const retained = [];
    for (const f of changed.reverse()) {
      try {
        replace(
          f.target,
          rollback ? f.afterBytes : f.beforeBytes,
          rollback ? f.beforeSha : f.afterSha,
        );
      } catch {
        retained.push(f.relative);
      }
    }
    // Keep the previous receipt on a preflight failure; no file mutation occurred.
    if (changed.length || (!rollback && fs.existsSync(receipt)))
      fs.writeFileSync(
        receipt,
        JSON.stringify(
          {
            sha256: approved,
            status: 'needs-reconciliation',
            error: error.message,
            retained,
          },
          null,
          2,
        ) + '\n',
      );
    throw error;
  } finally {
    release();
  }
}
function main(argv) {
  const action = argv.shift(),
    o = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (
      ![
        '--project',
        '--skill',
        '--plan',
        '--approved-sha256',
        '--scope',
        '--codex-home',
        '--on-duplicate',
      ].includes(k) ||
      o[k] ||
      !argv[i + 1]
    )
      throw Error('Invalid update argument: ' + k);
    o[k] = argv[++i];
  }
  if (!o['--plan']) throw Error('Supply --plan PATH');
  if (action === 'preview' || action === 'remove') {
    if (!o['--skill']) throw Error('Preview needs --skill');
    return savePlan(
      path.resolve(__dirname, '..'),
      o['--project'],
      o['--skill'],
      o['--plan'],
      {
        scope: o['--scope'] || 'global',
        codexHome: o['--codex-home'],
        onDuplicate: o['--on-duplicate'],
        remove: action === 'remove',
      },
    );
  }
  if (action === 'apply' || action === 'rollback')
    return transact(
      path.resolve(o['--project'] || '.', o['--plan']),
      o['--approved-sha256'],
      {
        rollback: action === 'rollback',
      },
    );
  throw Error('Choose preview, remove (preview), apply or rollback');
}
module.exports = { savePlan, loadPlan, transact, main };
if (require.main === module)
  try {
    console.log(JSON.stringify(main(process.argv.slice(2)), null, 2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
