'use strict';
const path = require('node:path');
const {execFile} = require('node:child_process');
const {createWindowsPolicyCheck,windowsPowerShellEnv} = require('./managed-windows-policy.cjs');
const helper = path.join(__dirname, 'managed-windows-tree.ps1');
// This adapter executes reviewed PowerShell only; no Add-Type or compiled helper.
function createWindowsTreeBackend({mode, powershell = 'powershell.exe', commandTimeoutMs = 2000, adapters = {}} = {}) {
  if (mode !== 'managed' || process.platform !== 'win32') throw Error('WINDOWS_MANAGED_BACKEND_REQUIRED');
  if (!Number.isSafeInteger(commandTimeoutMs) || commandTimeoutMs <= 0) throw Error('PROCESS_BOUNDS_INVALID');
  const checkPolicy = adapters.checkPolicy || createWindowsPolicyCheck({powershell,timeoutMs:commandTimeoutMs});
  let prepared;
  function prepare() { return prepared ||= Promise.resolve().then(checkPolicy); }
  async function call(action, identity) {
    await prepare();
    const args = ['-NoLogo','-NoProfile','-NonInteractive','-File',helper,'-Action',action];
    if (identity) {
      if (!Number.isSafeInteger(identity.pid) || identity.pid <= 0 || !Number.isSafeInteger(identity.parentPid) || !/^\d+$/.test(identity.created)) return Promise.reject(Error('PROCESS_IDENTITY_INVALID'));
      args.push('-TargetId',String(identity.pid),'-ParentId',String(identity.parentPid),'-Created',identity.created);
    }
    return new Promise((resolve,reject) => {
      // No execFile timeout: it would kill a non-Node helper. The controller bounds
      // the await, latches stop and never authorizes another operation on timeout.
      let expired = false;
      const timer = setTimeout(() => { expired = true; reject(Error('PROCESS_QUERY_TIMEOUT')); }, commandTimeoutMs);
      execFile(powershell,args,{windowsHide:true,encoding:'utf8',maxBuffer:4*1024*1024,env:windowsPowerShellEnv()},(error,stdout) => {
        clearTimeout(timer);
        if (expired) return;
        if (error) return reject(Error('PROCESS_OBSERVATION_FAILED'));
        try { resolve(JSON.parse(stdout.replace(/^\uFEFF/,''))); } catch { reject(Error('PROCESS_OBSERVATION_FAILED')); }
      });
    });
  }
  return Object.freeze({prepare, observe: () => call('observe'), signal: identity => call('signal',identity)});
}
module.exports = {createWindowsTreeBackend};
