'use strict';
const { execFile } = require('node:child_process');
const BLOCKED = 'MANAGED_POWERSHELL_POLICY_BLOCKED';
const MESSAGE =
  'Managed mode cannot start: PowerShell policy does not allow the bundled unsigned scripts. The policy was not changed.';
function windowsPowerShellEnv() {
  const env = { ...process.env };
  // A Node child of PowerShell 7 otherwise inherits incompatible module paths
  // into Windows PowerShell 5.1. Let that executable choose its own modules.
  // Preserve every policy variable; this does not change execution policy.
  for (const key of Object.keys(env))
    if (key.toLowerCase() === 'psmodulepath') delete env[key];
  return env;
}
function policyError(code) {
  return Object.assign(
    new Error(
      code === BLOCKED
        ? MESSAGE
        : 'Managed mode cannot start: PowerShell execution policy could not be verified.',
    ),
    { code },
  );
}
function policyDiagnostic(code) {
  return [BLOCKED, 'MANAGED_POWERSHELL_POLICY_UNAVAILABLE'].includes(code)
    ? { diagnostic: policyError(code).message }
    : {};
}
function createWindowsPolicyCheck({
  powershell = 'powershell.exe',
  timeoutMs = 2000,
  execute = execFile,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw Error('PROCESS_BOUNDS_INVALID');
  return function check() {
    return new Promise((resolve, reject) => {
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        reject(policyError('MANAGED_POWERSHELL_POLICY_UNAVAILABLE'));
      }, timeoutMs);
      const finish = (err, stdout) => {
        clearTimeout(timer);
        if (expired) return;
        if (err)
          return reject(policyError('MANAGED_POWERSHELL_POLICY_UNAVAILABLE'));
        const policy = String(stdout)
          .replace(/^\uFEFF/, '')
          .trim();
        // Conservative supported set for these local unsigned files. No policy
        // flag, Set-ExecutionPolicy, script-body evaluation or bypass fallback.
        if (!['RemoteSigned', 'Unrestricted'].includes(policy))
          return reject(policyError(BLOCKED));
        resolve({ allowed: true, policy });
      };
      try {
        execute(
          powershell,
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Get-ExecutionPolicy',
          ],
          {
            windowsHide: true,
            encoding: 'utf8',
            maxBuffer: 1024,
            env: windowsPowerShellEnv(),
          },
          finish,
        );
      } catch {
        finish(true);
      }
    });
  };
}
module.exports = {
  createWindowsPolicyCheck,
  windowsPowerShellEnv,
  policyDiagnostic,
  BLOCKED,
  MESSAGE,
};
