'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validTokens, localRunner } = require('./test-output.cjs');
function testCommand(tokens) {
  const [program, first, second] = tokens;
  return (
    (program === 'npm' &&
      (first === 'test' ||
        (first === 'run' &&
          /^test(?::[A-Za-z0-9_-]+)?$/.test(second || '')))) ||
    (['pnpm', 'yarn', 'bun'].includes(program) && first === 'test') ||
    (['npx', 'pnpm', 'yarn', 'bunx'].includes(program) &&
      ['vitest', 'jest'].includes(first)) ||
    ['vitest', 'jest', 'pytest'].includes(program) ||
    (program === 'go' && first === 'test') ||
    (program === 'node' && first === '--test') ||
    (['python', 'python3'].includes(program) &&
      first === '-m' &&
      second === 'pytest')
  );
}
// Check path syntax from both platforms regardless of the host running the hook.
function safeArguments(tokens) {
  return tokens.every((token, i) => {
    if (!token.startsWith('-')) {
      // win32.isAbsolute also recognizes POSIX-style leading slashes. Reject
      // drive-relative paths too: their base can differ from the working directory.
      return (
        !path.win32.isAbsolute(token) &&
        !/^[a-z]:/i.test(token) &&
        !token.split(/[\\/]/).includes('..')
      );
    }
    if (i === 1 && tokens[0] === 'node' && token === '--test') return true;
    if (i === 1 && ['python', 'python3'].includes(tokens[0]) && token === '-m')
      return true;
    return [
      '-q',
      '-v',
      '--verbose',
      '--runInBand',
      '--run',
      '--',
      '--bail',
    ].includes(token);
  });
}
function rulesAbsent(event, cwd) {
  // Only a missing directory means "no rules". Other inspection errors defer.
  function optionalEntry(file) {
    try {
      return fs.lstatSync(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    }
  }
  function directoryExists(dir) {
    const entry = optionalEntry(dir);
    if (entry) {
      if (entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(dir).isDirectory()))
        return true;
      throw Error('Not a directory');
    }
    // ENOENT can also mean a dangling link in a parent component.
    const parent = path.dirname(dir);
    if (parent !== dir) directoryExists(parent);
    return false;
  }
  function hasRules(root) {
    const dir = path.join(root, 'rules');
    return directoryExists(dir) &&
      fs.readdirSync(dir).some(name => name.toLowerCase().endsWith('.rules'));
  }
  try {
    const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    if (!path.isAbsolute(home) || hasRules(home)) return false;
    const system = process.platform === 'win32'
      ? path.join(process.env.ProgramData || path.join(path.parse(process.env.SystemRoot).root, 'ProgramData'), 'OpenAI', 'Codex')
      : '/etc/codex';
    if (!path.isAbsolute(system) || hasRules(system) ||
        optionalEntry(path.join(system, 'requirements.toml')))
      return false;

    // An explicit tool workdir can be outside the session's configuration tree.
    const visited = new Set();
    for (const start of new Set([cwd, event.cwd || process.cwd()])) {
      if (!path.isAbsolute(start) || !fs.statSync(start).isDirectory()) return false;
      for (let dir of [start, fs.realpathSync(start)]) {
        while (!visited.has(dir)) {
          visited.add(dir);
          if (hasRules(path.join(dir, '.codex'))) return false;
          dir = path.dirname(dir);
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}
function rewrite(event) {
  if (
    event?.hook_event_name !== 'PreToolUse' ||
    event.tool_name !== 'Bash' ||
    typeof event.tool_input?.command !== 'string' ||
    (Object.hasOwn(event.tool_input, 'sandbox_permissions') &&
      event.tool_input.sandbox_permissions !== 'use_default') ||
    process.env.FULL_TEST_OUTPUT === '1'
  )
    return {};
  const command = event.tool_input.command;
  if (command.includes('FULL_TEST_OUTPUT=1') || /[\r\n]/.test(command))
    return {};
  const tokens = command.trim().split(/\s+/);
  if (!validTokens(tokens) || !testCommand(tokens) || !safeArguments(tokens))
    return {};
  let cwd;
  try {
    cwd = path.resolve(
      event.cwd || process.cwd(),
      event.tool_input.workdir || event.tool_input.cwd || '.',
    );
  } catch {
    return {};
  }
  if (!rulesAbsent(event, cwd)) return {};
  if (['npx', 'bunx'].includes(tokens[0]) && !localRunner(tokens[1], cwd)) return {};
  const encoded = Buffer.from(
    path.join(__dirname, 'test-output.cjs'),
    'utf8',
  ).toString('base64');
  const js =
    "require(Buffer.from('" +
    encoded +
    "','base64').toString()).main(process.argv.slice(1)).catch(e=>{console.error(e.message);process.exitCode=1})";
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: {
        ...event.tool_input,
        command: 'node -e "' + js + '" -- ' + tokens.join(' '),
      },
    },
  };
}
module.exports = { rewrite, testCommand };
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (s) => (input += s));
  process.stdin.on('end', () => {
    try {
      process.stdout.write(JSON.stringify(rewrite(JSON.parse(input))));
    } catch (error) {
      process.stderr.write(error.message);
      process.exitCode = 1;
    }
  });
}
