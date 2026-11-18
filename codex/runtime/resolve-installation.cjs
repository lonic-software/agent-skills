'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { plainPath } = require('./queue-checkpoint.cjs');
function codeHome(value) {
  return plainPath(
    path.resolve(
      value || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    ),
  );
}
function roots(project, home) {
  return { project: plainPath(path.resolve(project)), home: codeHome(home) };
}
function file(p) {
  plainPath(p);
  if (!fs.existsSync(p)) return false;
  if (!fs.statSync(p).isFile())
    throw Error('Installation path is not a file: ' + p);
  return true;
}
function runtime(project, entry, home) {
  if (!['queue', 'evidence'].includes(entry))
    throw Error('Choose queue or evidence');
  const r = roots(project, home);
  for (const p of [
    path.join(r.project, '.codex/lonic/runtime', entry + '.cjs'),
    path.join(r.home, 'lonic/runtime', entry + '.cjs'),
  ])
    if (file(p)) return p;
  throw Error(
    'No project or global lonic runtime; install the required selection first',
  );
}
function skill(project, name, home) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
    throw Error('Invalid skill name');
  const r = roots(project, home);
  for (const p of [
    path.join(r.project, '.agents/skills', name, 'SKILL.md'),
    path.join(r.home, 'skills', name, 'SKILL.md'),
  ])
    if (file(p)) return p;
  throw Error(
    'Entry skill is missing in project and global installations: ' + name,
  );
}
function configPaths(project, home) {
  const r = roots(project, home);
  return [
    path.join(r.home, 'lonic/runtime-config.json'),
    path.join(r.project, '.codex/lonic/runtime-config.json'),
  ].filter(file);
}
function config(project, home) {
  const files = configPaths(project, home);
  if (!files.length)
    throw Error(
      'Create a reviewed project or global lonic/runtime-config.json from runtime-config.example.json',
    );
  let value = {};
  for (const p of files) {
    const layer = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!layer || typeof layer !== 'object' || Array.isArray(layer))
      throw Error('Runtime configuration must be an object: ' + p);
    value = { ...value, ...layer };
  }
  return value;
}
function describe(project, entry, home) {
  return {
    runtime: runtime(project, entry, home),
    configurationFiles: configPaths(project, home),
    precedence: 'project overrides global; top-level values replace, not union',
  };
}
module.exports = { codeHome, runtime, skill, configPaths, config, describe };
if (require.main === module) {
  try {
    const [project, entry, ...rest] = process.argv.slice(2);
    if (!project || !entry || rest.length)
      throw Error(
        'Usage: node resolve-installation.cjs PROJECT queue|evidence',
      );
    console.log(JSON.stringify(describe(project, entry), null, 2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
