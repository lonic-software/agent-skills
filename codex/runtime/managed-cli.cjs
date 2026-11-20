'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const { createManagedHost } = require('./managed-host.cjs');
const { runQueue } = require('./queue-controller.cjs');
const { authorTimeout } = require('./managed-deadline.cjs');
const {
  terminalEnrollment,
  enrollManagedAccount,
} = require('./managed-enrollment.cjs');
const { LIMITATION } = require('./managed-process.cjs');
const { TRUST_DIAGNOSTIC } = require('./managed-project-trust.cjs');
const trustMessage = (ruleId) =>
  ruleId === 'CFG_PROJECT_TRUSTED' ? TRUST_DIAGNOSTIC : undefined;
const { reconcileManaged } = require('./managed-reconcile.cjs');
const FLAGS = new Set([
  '--managed',
  '--enroll',
  '--reenroll',
  '--reconcile',
  '--after-reboot',
]);
const VALUES = new Set([
  '--config',
  '--project',
  '--profile',
  '--state-root',
  '--queue-kind',
  '--queue',
  '--item-id',
  '--authority-file',
  '--exclusions-file',
  '--threshold',
  '--spend',
  '--timeout-ms',
  '--bucket',
]);
function parse(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (Object.hasOwn(o, key) || (!FLAGS.has(key) && !VALUES.has(key)))
      throw Error('MANAGED_CLI_ARGUMENT_INVALID');
    if (FLAGS.has(key)) o[key] = true;
    else {
      if (!argv[i + 1] || argv[i + 1].startsWith('--'))
        throw Error('MANAGED_CLI_ARGUMENT_INVALID');
      o[key] = argv[++i];
    }
  }
  if (['--enroll', '--reenroll', '--reconcile'].filter((k) => o[k]).length > 1)
    throw Error('MANAGED_CLI_ARGUMENT_INVALID');
  if (o['--reconcile']) {
    const keys = ['--managed', '--reconcile', '--project', '--state-root'];
    if (
      keys.some((k) => !o[k]) ||
      Object.keys(o).some((k) => !keys.includes(k) && k !== '--after-reboot')
    )
      throw Error('MANAGED_CLI_ARGUMENT_INVALID');
    return o;
  }
  if (o['--after-reboot']) throw Error('MANAGED_CLI_ARGUMENT_INVALID');
  for (const k of [
    '--managed',
    '--config',
    '--project',
    '--profile',
    '--state-root',
  ])
    if (!o[k]) throw Error('MANAGED_CLI_ARGUMENT_REQUIRED');
  if (!o['--enroll'] && !o['--reenroll']) {
    if (
      o['--queue-kind'] !== 'file' ||
      !o['--queue'] ||
      !o['--authority-file'] ||
      !o['--timeout-ms']
    )
      throw Error('MANAGED_CLI_ARGUMENT_REQUIRED');
    authorTimeout(Number(o['--timeout-ms']));
    if ((o['--threshold'] === undefined) === (o['--spend'] === undefined))
      throw Error('MANAGED_BUDGET_REQUIRED');
    const number = Number(o['--threshold'] ?? o['--spend']);
    if (!Number.isFinite(number) || number <= 0 || number > 100)
      throw Error('MANAGED_BUDGET_REQUIRED');
  } else if (
    Object.keys(o).some(
      (k) =>
        ![
          '--managed',
          '--enroll',
          '--reenroll',
          '--config',
          '--project',
          '--profile',
          '--state-root',
        ].includes(k),
    )
  )
    throw Error('MANAGED_ENROLLMENT_ARGUMENT_INVALID');
  return o;
}
function write(stream, bytes) {
  return new Promise((resolve, reject) =>
    stream.write(bytes, (error) =>
      error ? reject(Error('MANAGED_OUTPUT_FAILED')) : resolve(),
    ),
  );
}
async function main(argv, dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout,
    stderr = dependencies.stderr || process.stderr;
  let host;
  const abort = new AbortController(),
    cancel = () => abort.abort();
  try {
    const o = parse(argv);
    // Check real interactive surfaces before constructing any native host/profile.
    const enrollment = o['--enroll'] || o['--reenroll'];
    const terminal =
      enrollment || o['--reconcile']
        ? dependencies.terminal ||
          terminalEnrollment(dependencies.stdin || process.stdin, stderr)
        : null;
    if (o['--reconcile']) {
      const result = await (dependencies.reconcile || reconcileManaged)({
        project: o['--project'],
        stateRoot: o['--state-root'],
        terminal,
        afterReboot: Boolean(o['--after-reboot']),
      });
      await write(stderr, JSON.stringify(result) + '\n');
      return 0;
    }
    const runtime = JSON.parse(fs.readFileSync(o['--config'], 'utf8'));
    if (
      runtime.schema !== 1 ||
      !path.isAbsolute(runtime.codex) ||
      typeof runtime.model !== 'string' ||
      !runtime.model
    )
      throw Error('MANAGED_CONFIG_INVALID');
    const project = path.resolve(o['--project']);
    const cfg = {
      codex: runtime.codex,
      model: runtime.model,
      effort: runtime.effort || 'medium',
      project,
      profile: path.resolve(o['--profile']),
      stateRoot: path.resolve(o['--state-root']),
      signal: abort.signal,
    };
    if (!enrollment)
      Object.assign(cfg, {
        task: {
          kind: 'file',
          locator: path.resolve(project, o['--queue']),
          itemId: o['--item-id'] || 'fixed-item',
        },
        authority: fs.readFileSync(o['--authority-file'], 'utf8'),
        exclusions: o['--exclusions-file']
          ? JSON.parse(fs.readFileSync(o['--exclusions-file'], 'utf8'))
          : [],
        budget:
          o['--threshold'] !== undefined
            ? { absolute: Number(o['--threshold']) }
            : { relative: Number(o['--spend']) },
        timeoutMs: Number(o['--timeout-ms']),
        bucket: o['--bucket'],
      });
    process.on('SIGINT', cancel);
    host = (dependencies.createHost || createManagedHost)(cfg);
    if (enrollment) {
      await enrollManagedAccount(host, terminal, {
        replace: Boolean(o['--reenroll']),
      });
      await write(
        stderr,
        'Managed account enrollment stored (fingerprint only).\n',
      );
      return 0;
    }
    await write(
      stderr,
      'Managed mode: sampled account checks, no native hooks, no policy bypass; input capture is synchronous and limited to 10000 files. ' +
        LIMITATION +
        '\n',
    );
    const grant = await host.prepare();
    host.host.consumeResult = async (delivery) => {
      const accepted = delivery.consume();
      await write(stdout, accepted.bytes);
      return accepted;
    };
    const result = await runQueue(
      { managed: true, managedRun: grant, signal: host.signal },
      { managed: host.host },
    );
    await write(
      stderr,
      JSON.stringify({
        status: result.status,
        receipt: result.receipt,
        reason: result.reason,
        ruleId: result.ruleId,
        diagnostic: trustMessage(result.ruleId),
        recoveryRequired: result.recoveryRequired,
      }) + '\n',
    );
    return result.status === 'refused'
      ? 4
      : result.status === 'completed'
        ? 0
        : result.status === 'incomplete'
          ? 2
          : 3;
  } catch (error) {
    if (error?.cleanRefusal === true && error.recoveryRequired === false) {
      await write(
        stderr,
        JSON.stringify({
          status: 'refused',
          reason: error.code,
          ruleId: error.ruleId,
          diagnostic: trustMessage(error.ruleId),
          recoveryRequired: false,
        }) + '\n',
      );
      return 4;
    }
    if (require('./managed-inventory-rules.cjs').isRefusal(error)) {
      await write(
        stderr,
        JSON.stringify({
          status: 'needs-reconciliation',
          reason: error.code,
          ruleId: error.ruleId,
          recoveryRequired: true,
        }) + '\n',
      );
      return 3;
    }
    const diagnostics = {
      MANAGED_RECOVERY_REBOOT_REQUIRED:
        'Recovery refused: no later full Windows boot is established.',
      MANAGED_BOOT_UNCERTAIN:
        'Recovery refused: Windows boot identity could not be verified.',
      MANAGED_RECOVERY_IDENTITY_MISSING:
        'Recovery refused: legacy or incomplete journal lacks full process identity. No PID guess, automatic settlement or process termination is permitted.',
      MANAGED_RECOVERY_PROCESS_LIVE:
        'Recovery refused: a recorded process identity is still alive. No process was terminated.',
      MANAGED_RECOVERY_OBSERVATION_UNCERTAIN:
        'Recovery refused: process absence could not be verified.',
      MANAGED_RECOVERY_NOT_CONFIRMED:
        'Recovery cancelled: exact terminal confirmation was not supplied.',
      MANAGED_POWERSHELL_POLICY_BLOCKED:
        'Managed mode cannot start: PowerShell policy blocks the bundled unsigned scripts. The policy was not changed.',
      MANAGED_POWERSHELL_POLICY_UNAVAILABLE:
        'Managed mode cannot start: PowerShell policy could not be verified.',
      INTERACTIVE_TERMINAL_REQUIRED:
        'Account enrollment and recovery require an interactive input and output terminal.',
      MANAGED_RECOVERY_REQUIRED:
        'An unresolved managed run requires operator reconciliation; no automatic retry.',
    };
    const diagnostic = diagnostics[error?.code] || diagnostics[error?.message];
    if (diagnostic) await write(stderr, diagnostic + '\n');
    await write(
      stderr,
      'MANAGED_CLI_FAILED: admission or lifecycle verification failed; no automatic retry.\n',
    );
    return 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    if (host)
      try {
        await host.dispose();
      } catch {
        /* Recovery journal remains unresolved. */
      }
  }
}
module.exports = { main, parse };
