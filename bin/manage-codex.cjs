#!/usr/bin/env node
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { plan } = require('./install-codex.cjs');
const { plainPath } = require('../codex/runtime/queue-checkpoint.cjs');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const current = (file) => {
  plainPath(file);
  if (!fs.existsSync(file)) return null;
  if (!fs.statSync(file).isFile()) throw Error('Not a regular file: ' + file);
  return fs.readFileSync(file);
};
const hash = (bytes) => (bytes === null ? null : sha(bytes));
function savePlan(repo, project, selection, file, options = {}) {
  const selected = plan(repo, project, selection, options);
  project = selected.project;
  if (
    selected.duplicates.length &&
    options.onDuplicate !== 'keep-both' &&
    !options.remove
  )
    throw Error(
      'Cross-scope skill collision: choose a scope or --on-duplicate keep-both',
    );
  if (options.remove && selected.files.some((f) => f.status === 'CONFLICT'))
    throw Error(
      'Removal refuses edited files; preserve or restore them before planning removal',
    );
  file = plainPath(file);
  if (fs.existsSync(file)) throw Error('Plan already exists');
  const files = selected.files
    .filter((f) =>
      options.remove ? f.status === 'MATCH' : f.status !== 'MATCH',
    )
    .map((f) => {
      const before = current(f.target);
      return {
        relative: f.relative,
        before: before?.toString('base64') ?? null,
        beforeSha: hash(before),
        after: options.remove ? null : f.bytes.toString('base64'),
        afterSha: options.remove ? null : f.sha256,
      };
    });
  if (files.some((f) => path.resolve(project, f.relative) === file))
    throw Error('Plan must not replace an installation target');
  const data = {
    schema: 1,
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
  if (
    data.schema !== 1 ||
    !['global', 'project'].includes(data.scope || 'project') ||
    !path.isAbsolute(data.project) ||
    !Array.isArray(data.files)
  )
    throw Error('Invalid update plan');
  plainPath(data.project);
  const seen = new Set();
  for (const f of data.files) {
    if (typeof f.relative !== 'string' || path.isAbsolute(f.relative))
      throw Error('Invalid target');
    const relative = f.relative.replaceAll('\\', '/');
    if (
      relative.split('/').some((p) => !p || p === '.' || p === '..') ||
      !(
        data.scope === 'global'
          ? /^(skills\/[a-z0-9-]+\/|agents\/lonic-[a-z0-9-]+\.toml$|lonic\/runtime\/|lonic\/runtime-config\.example\.json$)/
          : /^(\.agents\/skills\/[a-z0-9-]+\/|\.codex\/agents\/lonic-[a-z0-9-]+\.toml$|\.codex\/lonic\/runtime\/|\.codex\/lonic\/runtime-config\.example\.json$)/
      ).test(relative)
    )
      throw Error('Target outside the Codex package: ' + relative);
    const key = relative.toLowerCase();
    if (seen.has(key)) throw Error('Duplicate target');
    seen.add(key);
    f.target = plainPath(path.join(data.project, f.relative));
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
  const lock = plainPath(
    path.join(
      data.project,
      ...(data.scope === 'global' ? ['lonic'] : ['.codex', 'lonic']),
      'update.lock',
    ),
  );
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  plainPath(lock);
  fs.writeFileSync(lock, approved, { flag: 'wx', mode: 0o600 });
  const changed = [];
  let result;
  try {
    for (const f of data.files)
      if (hash(current(f.target)) !== (rollback ? f.afterSha : f.beforeSha))
        throw Error('File changed since the approved plan: ' + f.target);
    if (!rollback)
      fs.writeFileSync(
        receipt,
        JSON.stringify({ sha256: approved, status: 'applying' }) + '\n',
        { flag: 'wx', mode: 0o600 },
      );
    for (const f of rollback ? [...data.files].reverse() : data.files)
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
    try {
      if (fs.readFileSync(lock, 'utf8') === approved) fs.unlinkSync(lock);
    } catch {
      /* Preserve the transaction result; a retained lock requires manual reconciliation. */
    }
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
