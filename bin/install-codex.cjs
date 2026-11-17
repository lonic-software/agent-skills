#!/usr/bin/env node
'use strict';
// Project-local preview installer. Requires Node.js 18+; no package download.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');

function noLinks(target) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Refusing symlink or junction: ${cursor}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function within(root, relative) {
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error(`Path escapes its root: ${relative}`);
  return target;
}
function listFiles(directory) {
  noLinks(directory);
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing source symlink: ${full}`);
    if (entry.isDirectory()) result.push(...listFiles(full));
    else if (entry.isFile()) result.push(full);
    else throw new Error(`Unsupported source file: ${full}`);
  }
  return result;
}
function plan(repo, project, selection) {
  repo = path.resolve(repo); project = path.resolve(project);
  noLinks(project);
  if (!fs.statSync(project).isDirectory()) throw new Error('Project must be an existing directory');
  const source = path.join(repo, 'codex');
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  if (manifest.schema !== 1) throw new Error('Unsupported Codex manifest schema');
  if (Object.hasOwn(manifest.blocked, selection)) throw new Error(`NOT READY: ${selection}: ${manifest.blocked[selection]}`);
  if (!Object.hasOwn(manifest.selections, selection)) throw new Error(`Unknown selection: ${selection}`);
  const chosen = manifest.selections[selection];
  const files = [];
  const safeName = name => { if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(`Invalid package name: ${name}`); return name; };
  for (const name of chosen.skills.map(safeName)) {
    const skillRoot = within(source, path.join('skills', name));
    if (!fs.statSync(path.join(skillRoot, 'SKILL.md')).isFile()) throw new Error(`Missing SKILL.md: ${name}`);
    for (const file of listFiles(skillRoot)) files.push({ source: file, relative: path.join('.agents', 'skills', name, path.relative(skillRoot, file)) });
  }
  for (const name of chosen.agents.map(safeName)) files.push({ source: within(source, path.join('agents', name + '.toml')), relative: path.join('.codex', 'agents', name + '.toml') });
  if (chosen.runtime !== undefined && chosen.runtime !== true) throw new Error('Invalid runtime selection');
  if (chosen.runtime) {
    const runtimeRoot = within(source, 'runtime');
    for (const file of listFiles(runtimeRoot)) files.push({source: file, relative: path.join('.codex', 'lonic', 'runtime', path.relative(runtimeRoot, file))});
  }
  const seen = new Set();
  for (const file of files) {
    noLinks(file.source);
    const key = file.relative.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate destination: ${file.relative}`);
    seen.add(key);
    file.target = within(project, file.relative);
    noLinks(file.target);
    file.bytes = fs.readFileSync(file.source);
    file.sha256 = digest(file.bytes);
    if (fs.existsSync(file.target)) {
      if (!fs.statSync(file.target).isFile()) throw new Error(`Destination is not a regular file: ${file.target}`);
      file.status = fs.readFileSync(file.target).equals(file.bytes) ? 'MATCH' : 'CONFLICT';
    } else file.status = 'CREATE';
  }
  return { project, selection, packageStatus: manifest.status, files };
}
function apply(planned) {
  if (planned.files.some(file => file.status === 'CONFLICT')) throw new Error('Existing content differs; no files were changed');
  // Recheck the entire plan before writing, then create each new file exclusively.
  for (const file of planned.files) {
    noLinks(file.target);
    if (file.status === 'MATCH' && (!fs.existsSync(file.target) || digest(fs.readFileSync(file.target)) !== file.sha256)) throw new Error(`Destination changed since preview: ${file.target}`);
    if (file.status === 'CREATE' && fs.existsSync(file.target)) throw new Error(`Destination appeared since preview: ${file.target}`);
    if (digest(fs.readFileSync(file.source)) !== file.sha256) throw new Error(`Source changed since preview: ${file.source}`);
  }
  const created = [];
  try {
    for (const file of planned.files.filter(file => file.status === 'CREATE')) {
      fs.mkdirSync(path.dirname(file.target), { recursive: true });
      noLinks(file.target);
      const descriptor = fs.openSync(file.target, 'wx');
      created.push(file);
      try { fs.writeFileSync(descriptor, file.bytes); }
      finally { fs.closeSync(descriptor); }
      if (digest(fs.readFileSync(file.target)) !== file.sha256) throw new Error(`Readback failed: ${file.target}`);
    }
  } catch (error) {
    // Remove only files this invocation created and whose bytes still match.
    const retained = [];
    for (const file of created.reverse()) {
      try { noLinks(file.target); if (digest(fs.readFileSync(file.target)) === file.sha256) fs.unlinkSync(file.target); else retained.push(file.target); }
      catch { retained.push(file.target); }
    }
    if (retained.length) error.message += `; partial files retained: ${retained.join(', ')}`;
    throw error;
  }
  return created.length;
}
function main(argv) {
  const options = {}; let mode = 'preview';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--check') {
      if (mode !== 'preview') throw new Error('Choose at most one of --apply and --check');
      mode = arg.slice(2);
    } else if (arg === '--project' || arg === '--skill') {
      if (options[arg] || !argv[i+1] || argv[i+1].startsWith('--')) throw new Error(`Missing or duplicate argument: ${arg}`);
      options[arg] = argv[++i];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options['--project'] || !options['--skill']) throw new Error('Usage: node bin/install-codex.cjs --project PATH --skill SELECTION [--apply|--check]');
  const planned = plan(path.resolve(__dirname, '..'), options['--project'], options['--skill']);
  console.log(JSON.stringify({ mode, project: planned.project, selection: planned.selection, packageStatus: planned.packageStatus, files: planned.files.map(({relative,status,sha256}) => ({path: relative, status, sha256})) }, null, 2));
  if (mode === 'apply') console.log(`Created ${apply(planned)} files. Review the project and start a new Codex session. Full workflow parity is not claimed.`);
  if (mode === 'check' && planned.files.some(file => file.status !== 'MATCH')) return 2;
  if (mode === 'preview' && planned.files.some(file => file.status === 'CONFLICT')) return 2;
  return 0;
}
if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { plan, apply, main };
