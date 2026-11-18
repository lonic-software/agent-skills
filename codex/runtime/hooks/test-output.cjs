'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  { spawn } = require('node:child_process'),
  readline = require('node:readline');
function validTokens(tokens) {
  return (
    Array.isArray(tokens) &&
    tokens.length > 0 &&
    tokens.every(
      (s) => typeof s === 'string' && /^[A-Za-z0-9_./:=+-]+$/.test(s),
    )
  );
}
// Execute the checked local shim directly so a later removal cannot trigger a download.
function localRunner(binary, cwd) {
  if (!['jest', 'vitest'].includes(binary)) return null;
  const shim = path.join(
    'node_modules',
    '.bin',
    binary + (process.platform === 'win32' ? '.cmd' : ''),
  );
  const file = path.resolve(cwd, shim);
  try {
    if (!fs.statSync(file).isFile()) return null;
    fs.accessSync(
      file,
      process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK,
    );
  } catch {
    return null;
  }
  return shim;
}
async function summarize(file) {
  let count = 0,
    context = 0;
  const first = [],
    failures = [],
    summaries = [];
  let clipped = false;
  const rows = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  for await (const raw of rows) {
    count++;
    const line =
      raw.length > 2000 ? raw.slice(0, 2000) + ' [line shortened]' : raw;
    clipped ||= raw.length > 2000;
    if (first.length < 80) first.push(line);
    if (
      /FAIL|✗|×|AssertionError|Error:|error:|expected|Expected|Received|panicked|--- FAIL/.test(
        line,
      )
    )
      context = 7;
    if (context > 0) {
      if (failures.length < 150) failures.push(line);
      context--;
    }
    if (
      /Test Files|Tests\s|Suites?:|passed|failed|Duration|^ok |^FAIL|=+ .*(passed|failed)/.test(
        line,
      )
    ) {
      summaries.push(line);
      if (summaries.length > 15) summaries.shift();
    }
  }
  let output =
    count <= 80
      ? first.join('\n')
      : [...failures, '...', ...summaries].join('\n');
  if (output.length > 20000) {
    output = output.slice(0, 20000) + '\n[display shortened]';
    clipped = true;
  }
  return { output, count, filtered: count > 80 || clipped };
}
async function main(tokens) {
  if (tokens[0] === '--') tokens = tokens.slice(1);
  if (!validTokens(tokens))
    throw Error(
      'Only simple literal argument tokens are supported by this wrapper',
    );
  if (['npx', 'bunx'].includes(tokens[0])) {
    const shim = localRunner(tokens[1], process.cwd());
    if (!shim) throw Error('Local test runner is unavailable');
    tokens = [shim, ...tokens.slice(2)];
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lonic-test-output-')),
    file = path.join(root, 'full.log');
  const fd = fs.openSync(file, 'wx', 0o600);
  // Write child output directly to the retained file. On the tested Linux
  // execution boundary, child pipe reads fail with EPERM and lose output.
  let child, outcome;
  try {
    outcome = await new Promise((resolve) => {
      const options = { windowsHide: true, stdio: ['inherit', fd, fd] };
      child =
        process.platform === 'win32'
          ? spawn(tokens.join(' '), {
              ...options,
              shell: process.env.ComSpec || 'cmd.exe',
            })
          : spawn(tokens[0], tokens.slice(1), options);
      child.on('error', (error) => resolve({ error }));
      child.on('close', (code, signal) => resolve({ code, signal }));
    });
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const result = await summarize(file);
  if (result.output) process.stdout.write(result.output + '\n');
  process.stdout.write(
    '[lonic test output: ' +
      result.count +
      ' lines; ' +
      (result.filtered ? 'failure/summary excerpts' : 'full displayed output') +
      '; complete log: ' +
      file +
      ']\n',
  );
  if (outcome.error) {
    process.stderr.write(outcome.error.message + '\n');
    process.exitCode = 127;
  } else
    process.exitCode =
      outcome.code ?? 128 + (os.constants.signals[outcome.signal] || 1);
}
module.exports = { validTokens, localRunner, summarize, main };
if (require.main === module)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
