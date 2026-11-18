'use strict';
const { execFile } = require('node:child_process');
const {
  createWindowsPolicyCheck,
  windowsPowerShellEnv,
} = require('./managed-windows-policy.cjs');
async function readWindowsBoot({
  execute = execFile,
  checkPolicy = createWindowsPolicyCheck(),
} = {}) {
  await checkPolicy();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error('MANAGED_BOOT_UNCERTAIN')),
      15000,
    );
    execute(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$ErrorActionPreference='Stop'; (Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 5).LastBootUpTime.ToUniversalTime().Ticks.ToString()",
      ],
      {
        windowsHide: true,
        env: windowsPowerShellEnv(),
        encoding: 'utf8',
        maxBuffer: 1024,
      },
      (error, stdout) => {
        clearTimeout(timer);
        const ticks = String(stdout).trim();
        if (error || !/^\d{18}$/.test(ticks))
          reject(Error('MANAGED_BOOT_UNCERTAIN'));
        else resolve(ticks);
      },
    );
  });
}
module.exports = { readWindowsBoot };
