#!/usr/bin/env node
'use strict';
// Global-default CLI with explicit project scope; preview installer. Requires Node.js 18+; no package download.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');

const {
  trustedRoot,
  checkedPath,
} = require('../codex/runtime/trusted-path.cjs');
function noLinks(target) {
  return checkedPath(target, [], 'Refusing symlink or junction');
}
function within(root, relative) {
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (
    !rel ||
    rel === '..' ||
    rel.startsWith('..' + path.sep) ||
    path.isAbsolute(rel)
  )
    throw new Error(`Path escapes its root: ${relative}`);
  return target;
}
function listFiles(directory) {
  noLinks(directory);
  const result = [];
  for (const entry of fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Refusing source symlink: ${full}`);
    if (entry.isDirectory()) result.push(...listFiles(full));
    else if (entry.isFile()) result.push(full);
    else throw new Error(`Unsupported source file: ${full}`);
  }
  return result;
}
function plan(repo, project, selection, options = {}) {
  const scope = options.scope || 'project';
  if (!['global', 'project'].includes(scope))
    throw new Error('Choose --scope global or project');
  if (options.onDuplicate !== undefined && options.onDuplicate !== 'keep-both')
    throw new Error(
      'Choose --on-duplicate keep-both or remove one installation',
    );
  if (scope === 'project' && !project)
    throw new Error('Project scope requires --project');
  const contextProject = trustedRoot(project || process.cwd());
  const codexHome = trustedRoot(
    options.codexHome ||
      process.env.CODEX_HOME ||
      path.join(os.homedir(), '.codex'),
  );
  repo = noLinks(repo);
  project = scope === 'global' ? codexHome : contextProject;
  noLinks(project);
  noLinks(contextProject);
  noLinks(codexHome);
  if (!fs.statSync(contextProject).isDirectory())
    throw new Error('Project must be an existing directory');
  if (fs.existsSync(project) && !fs.statSync(project).isDirectory())
    throw new Error('Target must be a directory');
  if (scope === 'global' && selection === 'test-filter-hook')
    throw new Error(
      'Native hook activation is project-only; choose --scope project',
    );
  const source = path.join(repo, 'codex');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'),
  );
  if (manifest.schema !== 1)
    throw new Error('Unsupported Codex manifest schema');
  if (Object.hasOwn(manifest.blocked, selection))
    throw new Error(`NOT READY: ${selection}: ${manifest.blocked[selection]}`);
  if (!Object.hasOwn(manifest.selections, selection))
    throw new Error(`Unknown selection: ${selection}`);
  const chosen = manifest.selections[selection];
  const files = [];
  const safeName = (name) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
      throw new Error(`Invalid package name: ${name}`);
    return name;
  };
  for (const name of chosen.skills.map(safeName)) {
    const skillRoot = within(source, path.join('skills', name));
    if (!fs.statSync(path.join(skillRoot, 'SKILL.md')).isFile())
      throw new Error(`Missing SKILL.md: ${name}`);
    for (const file of listFiles(skillRoot))
      files.push({
        source: file,
        relative: path.join(
          ...(scope === 'global' ? ['skills'] : ['.agents', 'skills']),
          name,
          path.relative(skillRoot, file),
        ),
      });
  }
  for (const name of chosen.agents.map(safeName))
    files.push({
      source: within(source, path.join('agents', name + '.toml')),
      relative: path.join(
        ...(scope === 'global' ? ['agents'] : ['.codex', 'agents']),
        name + '.toml',
      ),
    });
  if (chosen.runtime !== undefined && chosen.runtime !== true)
    throw new Error('Invalid runtime selection');
  if (chosen.runtime) {
    const runtimeRoot = within(source, 'runtime');
    for (const file of listFiles(runtimeRoot))
      files.push({
        source: file,
        relative: path.join(
          ...(scope === 'global'
            ? ['lonic', 'runtime']
            : ['.codex', 'lonic', 'runtime']),
          path.relative(runtimeRoot, file),
        ),
      });
  }
  if (
    chosen.runtime &&
    fs.existsSync(path.join(source, 'runtime-config.example.json'))
  )
    files.push({
      source: path.join(source, 'runtime-config.example.json'),
      relative: path.join(
        ...(scope === 'global' ? ['lonic'] : ['.codex', 'lonic']),
        'runtime-config.example.json',
      ),
    });
  const collisionTargets = chosen.skills.map((name) =>
    path.join(
      scope === 'global' ? contextProject : codexHome,
      ...(scope === 'global' ? ['.agents', 'skills'] : ['skills']),
      name,
      'SKILL.md',
    ),
  );
  for (const target of collisionTargets) noLinks(target);
  const duplicates = collisionTargets.filter((target) => fs.existsSync(target));
  const seen = new Set();
  for (const file of files) {
    noLinks(file.source);
    const key = file.relative.toLowerCase();
    if (seen.has(key))
      throw new Error(`Duplicate destination: ${file.relative}`);
    seen.add(key);
    file.target = within(project, file.relative);
    noLinks(file.target);
    file.bytes = fs.readFileSync(file.source);
    file.sha256 = digest(file.bytes);
    if (fs.existsSync(file.target)) {
      if (!fs.statSync(file.target).isFile())
        throw new Error(`Destination is not a regular file: ${file.target}`);
      file.status = fs.readFileSync(file.target).equals(file.bytes)
        ? 'MATCH'
        : 'CONFLICT';
    } else file.status = 'CREATE';
  }
  return {
    project,
    scope,
    contextProject,
    codexHome,
    selection,
    packageStatus: manifest.status,
    files,
    duplicates,
    collisionTargets,
    onDuplicate: options.onDuplicate,
  };
}
function apply(planned) {
  if (
    (planned.collisionTargets || []).some((p) => {
      noLinks(p);
      return fs.existsSync(p);
    }) &&
    planned.onDuplicate !== 'keep-both'
  )
    throw new Error(
      'Cross-scope skill collision: choose one scope, remove the other installation, or explicitly --on-duplicate keep-both; no files changed',
    );
  if (planned.files.some((file) => file.status === 'CONFLICT'))
    throw new Error('Existing content differs; no files were changed');
  // Recheck the entire plan before writing, then create each new file exclusively.
  for (const file of planned.files) {
    noLinks(file.target);
    if (
      file.status === 'MATCH' &&
      (!fs.existsSync(file.target) ||
        digest(fs.readFileSync(file.target)) !== file.sha256)
    )
      throw new Error(`Destination changed since preview: ${file.target}`);
    if (file.status === 'CREATE' && fs.existsSync(file.target))
      throw new Error(`Destination appeared since preview: ${file.target}`);
    if (digest(fs.readFileSync(file.source)) !== file.sha256)
      throw new Error(`Source changed since preview: ${file.source}`);
  }
  const created = [];
  try {
    for (const file of planned.files.filter(
      (file) => file.status === 'CREATE',
    )) {
      fs.mkdirSync(path.dirname(file.target), { recursive: true });
      noLinks(file.target);
      const descriptor = fs.openSync(file.target, 'wx');
      created.push(file);
      try {
        fs.writeFileSync(descriptor, file.bytes);
      } finally {
        fs.closeSync(descriptor);
      }
      if (digest(fs.readFileSync(file.target)) !== file.sha256)
        throw new Error(`Readback failed: ${file.target}`);
    }
  } catch (error) {
    // Remove only files this invocation created and whose bytes still match.
    const retained = [];
    for (const file of created.reverse()) {
      try {
        noLinks(file.target);
        if (digest(fs.readFileSync(file.target)) === file.sha256)
          fs.unlinkSync(file.target);
        else retained.push(file.target);
      } catch {
        retained.push(file.target);
      }
    }
    if (retained.length)
      error.message += `; partial files retained: ${retained.join(', ')}`;
    throw error;
  }
  return created.length;
}
function main(argv) {
  const options = {};
  let mode = 'preview';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--check') {
      if (mode !== 'preview')
        throw new Error('Choose at most one of --apply and --check');
      mode = arg.slice(2);
    } else if (
      [
        '--project',
        '--skill',
        '--scope',
        '--codex-home',
        '--on-duplicate',
      ].includes(arg)
    ) {
      if (options[arg] || !argv[i + 1] || argv[i + 1].startsWith('--'))
        throw new Error(`Missing or duplicate argument: ${arg}`);
      options[arg] = argv[++i];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options['--skill'])
    throw new Error(
      'Usage: node bin/install-codex.cjs --skill SELECTION [--scope global|project] [--project PATH] [--codex-home PATH] [--on-duplicate keep-both] [--apply|--check]',
    );
  const planned = plan(
    path.resolve(__dirname, '..'),
    options['--project'],
    options['--skill'],
    {
      scope: options['--scope'] || 'global',
      codexHome: options['--codex-home'],
      onDuplicate: options['--on-duplicate'],
    },
  );
  console.log(
    JSON.stringify(
      {
        mode,
        scope: planned.scope,
        root: planned.project,
        project: planned.contextProject,
        duplicates: planned.duplicates,
        duplicateDecision: planned.onDuplicate || 'required-if-listed',
        selection: planned.selection,
        packageStatus: planned.packageStatus,
        files: planned.files.map(({ relative, status, sha256 }) => ({
          path: relative,
          status,
          sha256,
        })),
      },
      null,
      2,
    ),
  );
  if (mode === 'apply')
    console.log(
      `Created ${apply(planned)} files. Review the selected installation and start a new Codex session. Full workflow parity is not claimed.`,
    );
  if (mode === 'check' && planned.files.some((file) => file.status !== 'MATCH'))
    return 2;
  if (
    mode === 'preview' &&
    (planned.files.some((file) => file.status === 'CONFLICT') ||
      (planned.duplicates.length && planned.onDuplicate !== 'keep-both'))
  )
    return 2;
  return 0;
}
if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { plan, apply, main, noLinks };
