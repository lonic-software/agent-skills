'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { bounded, observeChild } = require('./managed-process.cjs');
const { createWindowsTreeBackend } = require('./managed-windows-tree.cjs');
const {
  createWindowsPolicyCheck,
  windowsPowerShellEnv,
} = require('./managed-windows-policy.cjs');
function gateIdentity(file) {
  const resolved = fs.realpathSync(file);
  if (fs.lstatSync(file).isSymbolicLink()) throw Error('GATE_LINK_REFUSED');
  const stat = fs.statSync(resolved, { bigint: true });
  if (!stat.isFile() || stat.size < 1n || stat.size > 4096n)
    throw Error('GATE_FILE_INVALID');
  return { key: resolved.toLowerCase(), identity: `${stat.dev}:${stat.ino}` };
}
function createWindowsGateAdapter({
  mode,
  gatePath,
  powershell = 'powershell.exe',
  timeoutMs = 3000,
  adapters = {},
} = {}) {
  if (
    mode !== 'managed' ||
    process.platform !== 'win32' ||
    typeof gatePath !== 'string' ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 500
  )
    throw Error('WINDOWS_GATE_INPUT_INVALID');
  const tree =
    adapters.tree ||
    createWindowsTreeBackend({ mode, powershell, commandTimeoutMs: timeoutMs });
  const spawnHelper = adapters.spawnHelper || spawn;
  const checkPolicy =
    adapters.checkPolicy || createWindowsPolicyCheck({ powershell, timeoutMs });
  let loss = () => {},
    child,
    watcher,
    expected,
    intent,
    helper,
    pending,
    heartbeat,
    pinging,
    releasing = false,
    failed = false;
  function lost() {
    if (!failed) {
      failed = true;
      clearInterval(heartbeat);
      loss();
      if (pending) {
        pending.reject(Error('GATE_HELPER_LOST'));
        pending = null;
      }
    }
  }
  function checkedIdentity() {
    const actual = gateIdentity(gatePath);
    if (actual.key !== expected.key || actual.identity !== expected.identity)
      throw Error('GATE_IDENTITY_CHANGED');
    return actual;
  }
  function waitMessage(kind = 'held') {
    if (pending || failed)
      return Promise.reject(Error('GATE_HELPER_UNAVAILABLE'));
    return bounded(
      () =>
        new Promise((resolve, reject) => {
          pending = { resolve, reject, kind };
        }),
      timeoutMs,
    ).catch((e) => {
      lost();
      throw e;
    });
  }
  function ping() {
    // Share the same bounded, validated reply with foreground checks. A pending
    // heartbeat is work in progress, not evidence of lost gate ownership.
    if (pinging) return pinging;
    pinging = (async () => {
      const reply = waitMessage();
      child.stdin.write('ping\n');
      await reply;
      if (failed || !watcher.live()) throw Error('GATE_HELPER_LOST');
    })().finally(() => {
      pinging = null;
    });
    return pinging;
  }
  function state() {
    return {
      locked: !failed,
      ownerBound: true,
      ownerAlive: true,
      intentId: intent.id,
      gate: checkedIdentity(),
      helper: { ...helper },
    };
  }
  return Object.freeze({
    onLoss(callback) {
      loss = callback;
    },
    async abandon() {
      releasing = true;
      clearInterval(heartbeat);
      if (pending) {
        pending.reject(Error('GATE_ABANDONED'));
        pending = null;
      }
      if (!child || watcher.snapshot().closed) return;
      const closed = new Promise((resolve) => child.once('close', resolve));
      watcher.requestClose();
      await bounded(() => closed, timeoutMs);
    },
    async open({ expectedIdentity, registeredIntent }) {
      if (child) throw Error('GATE_ALREADY_STARTED');
      await checkPolicy();
      expected = { ...expectedIdentity };
      intent = { ...registeredIntent };
      checkedIdentity();
      const nonce = fs.readFileSync(gatePath, 'utf8');
      checkedIdentity();
      const ownerView = await tree.observe(),
        owner = ownerView.processes.find((p) => p.pid === process.pid);
      if (!ownerView.complete || !owner?.created)
        throw Error('GATE_OWNER_UNCERTAIN');
      child = spawnHelper(
        powershell,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-File',
          path.join(__dirname, 'managed-windows-gate.ps1'),
          '-GatePath',
          gatePath,
        ],
        {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: windowsPowerShellEnv(),
        },
      );
      watcher = observeChild(child);
      child.on('error', lost);
      child.on('exit', () => {
        if (!releasing) lost();
      });
      child.on('close', () => {
        if (!releasing) lost();
      });
      child.stderr.on('data', lost);
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        if (buffer.length > 4096) {
          lost();
          return;
        }
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          try {
            const event = JSON.parse(line);
            if (
              event.intentId !== intent.id ||
              !pending ||
              event.event !== pending.kind
            ) {
              lost();
              return;
            }
            const waiter = pending;
            pending = null;
            waiter.resolve();
          } catch {
            lost();
          }
        }
      });
      const ready = waitMessage('locked');
      child.stdin.write(
        JSON.stringify({
          intentId: intent.id,
          nonce,
          ownerPid: process.pid,
          ownerCreated: owner.created,
        }) + '\n',
      );
      await ready;
      const view = await tree.observe();
      helper = view.processes.find((p) => p.pid === child.pid);
      if (
        !view.complete ||
        helper?.parentPid !== process.pid ||
        !helper.created ||
        !watcher.live() ||
        failed
      )
        throw Error('GATE_HELPER_UNCERTAIN');
      checkedIdentity();
      heartbeat = setInterval(
        () => {
          if (!pending && !releasing) void ping().catch(lost);
        },
        Math.max(100, Math.floor(timeoutMs / 3)),
      );
      return state();
    },
    async observe() {
      if (!watcher?.live() || failed) throw Error('GATE_HELPER_LOST');
      // Join any in-flight heartbeat; still require its verified response.
      await ping();
      return state();
    },
    async release() {
      if (!watcher || failed) throw Error('GATE_HELPER_LOST');
      releasing = true;
      clearInterval(heartbeat);
      if (pinging) await pinging;
      if (failed || !watcher.live()) throw Error('GATE_HELPER_LOST');
      const closed = new Promise((resolve) => child.once('close', resolve));
      watcher.requestClose();
      await bounded(() => closed, timeoutMs);
      const view = await tree.observe(),
        s = watcher.snapshot();
      if (!view.complete || child.exitCode !== 0 || s.failed)
        throw Error('GATE_RELEASE_UNOBSERVED');
      return {
        exited: s.exited,
        stdoutClosed: s.stdout,
        stderrClosed: s.stderr,
        handlers: s.handlers,
        survivors: view.processes.filter((p) => p.pid === helper.pid),
      };
    },
  });
}
module.exports = { createWindowsGateAdapter, gateIdentity };
