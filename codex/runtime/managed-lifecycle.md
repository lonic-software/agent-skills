# Managed lifecycle adapters — step 2

Status: components only; the ordinary queue and RPC entry points are not wired to these adapters. B1 remains **unfinished, proceeding by operator decision**. Do not launch a native Codex process through this work without separate authorization and later integration/validation.

## Windows guarantee

**best-effort observed tree cleanup, not proof of containment**

This implementation uses bounded tree enumeration and repeated PID, creation-time and parent checks. It does not use a Job Object, a compiled helper or Add-Type. The target's process handle is retained and its creation time checked again before signalling. Parent exit alone is not settlement: require observed process/stream closure, no pending handlers, and repeated observations with no surviving members.

Unknown ownership, reused PID, observation/signal failure, timeout, unexpected death or any observed survivor stops the run. No continuation or automatic retry follows. Preserve recovery-required state; a later successful observation cannot clear the stop latch. The only permitted intermediate helper is the independently verified, owner-bound cooperative gate; it must also exit before final success.

Escaping or unobserved descendants, reparenting and same-user races can exceed these observations. A clean result means the stated observations passed, not that all possible processes were contained. The host must register intent before spawn, and must not admit work until launch ownership is observed. That initial observation is not pre-execution containment.

### Step 2b: live membership and cleanup on failure

While the author is live, the owner performs nonoverlapping tree observations and registers new descendants. Step 2c changes the default `monitorMs` from 250 to 5,000 ms; it is the delay after an observation completes, not a guaranteed sampling frequency. This deliberately reduces one-shot PowerShell launches at the cost of a larger observation gap. The printed limitation remains: **polling can miss a short-lived parent and its descendants between observations**. No containment or complete descendant-discovery guarantee follows.

Step 2c permits `maxMonitorFailures` consecutive missing/failed live samples (default 2, supported range 0–10); the next failure stops. A successful sample resets the streak. A slow successful sample does not stop the run. Positive evidence of a changed/reused still-owned identity remains fatal. Startup and final close do not use this tolerance: every required complete observation, ownership check and cleanup obligation must pass. `status().monitor` reports attempts, successes, failures, slow samples (default threshold 1,500 ms), consecutive failures, observation wall milliseconds and distinct observed orphan identities.

An already registered orphan remains a member after its parent exits. It may exit naturally or be cleaned with the same identity checks as any other descendant; orphanhood alone no longer revokes continuation. An actual survivor or uncertain ownership still refuses. A separate observation of a non-root member's absence retires authority over that old PID. A later process using that PID is not signalled using stale authority; it must be freshly established as an owned descendant before registration. Reuse without a prior absence observation remains a conservative refusal. These distinctions are covered by synthetic and real process tests.

Always call `close` after refusal, interruption, error or unexpected exit as well as after successful completion. An incomplete turn, child error or unexpected exit latches refusal but no longer skips cleanup. The same identity checks and descendant-first signalling apply to every identified live member. Successful cleanup on this failure path returns `allowed:false`, `recoveryRequired:true`, `cleanupObserved:true`; it never restores continuation. Unknown identities, survivors or timeout still cannot be called clean. Unidentified processes are never signalled.

`closeTimeoutMs` configures one total close deadline, including any outstanding monitor observation, all subsequent scans/signals, polls and stream/handler settlement. It defaults to `timeoutMs` for compatibility; callers must choose an explicit practical bound. `timeoutMs` separately bounds startup and each live-monitor observation. `maxRounds` remains an additional cap. The step-2b two-process tests use 35,000 ms for close and 15,000 ms for startup/monitor, not an unbounded loop. On the measured machine a focused observation took roughly 0.7–1.2 s and a checked signal roughly 0.8–0.9 s; these are recorded samples, not latency guarantees. A short close budget can expire before several checked operations finish. A timed-out PowerShell helper is not forcibly killed and cannot be presumed settled.

### PowerShell execution-policy admission

Both bundled `.ps1` files require a permitting effective Windows PowerShell policy. Before author/helper startup, query `Get-ExecutionPolicy` using `-NoProfile`; do not attempt either script under `Restricted`. The conservative supported set for these local unsigned sources is `RemoteSigned` and `Unrestricted`. `AllSigned`, `Restricted`, unrecognized values and unverified reads refuse. No `-ExecutionPolicy` override, `Set-ExecutionPolicy`, script-body evaluation fallback or automatic policy change is used. A later policy change may cause script execution to fail; that remains a refusal, never a reason to bypass policy.

Fixed diagnostic `MANAGED_POWERSHELL_POLICY_BLOCKED`: **Managed mode cannot start: PowerShell policy does not allow the bundled unsigned scripts. The policy was not changed.** Failed/unavailable policy reads produce `MANAGED_POWERSHELL_POLICY_UNAVAILABLE`. These diagnostics survive the process and gate policy wrappers. Only each helper child's inherited `PSModulePath` is removed so Windows PowerShell chooses its own compatible modules instead of PowerShell 7 modules; policy environment variables and the parent environment remain unchanged. This does not alter the effective execution policy.

Managed mode also remains unavailable with any enabled native hook, including lonic's own test-output filter hook.

## One budget for the whole run

The host creates `createManagedRunBudget({mode: 'managed', grant, bucket})` once and keeps the returned object in controller memory. Pass it as `runBudget` to every `createManagedAdmission` generation and use its `check` method for intermediate meters. An admission without `runBudget` creates the initial authority for compatibility with step 1; its `.runBudget` must then be retained by the controller and passed to every successor. Creating a new authority per author is incorrect.

The original weekly anchor, initial percentage and threshold are never replaced. A relative threshold is calculated once. Latest accepted usage/timestamps and the irreversible stop state also carry over. `snapshot()` is host-only diagnostics; a serialized/reconstructed snapshot is rejected as live authority. Account-related hashes remain private host data. Explicit `bucket` selection feeds the same initial usage selection used by the legacy queue; the shared authority pins it afterward.

## Process and gate interfaces

- `createManagedProcess` accepts explicit managed mode, a trusted `observe`/`signal` backend with optional startup `prepare`, bounded time/round/monitor settings and an immediate stop callback. `start` requires a registered intent and a synchronous spawn callback. Preflight runs before spawn; process/stream observations attach before awaiting discovery. No model or Codex executable is hardcoded. A failed or uncertain launch is spent, not retried.
- Register outstanding host handlers with `trackHandler`. `close({turnCompleted: true})` revokes live generation rights, ends stdin, then performs checked cleanup. Callers must check `live()` immediately before any response/publish action. A completed turn is necessary but not sufficient for continuation. Close is single-flight, and a failed close cannot be retried into success.
- `createWindowsTreeBackend` uses reviewed PowerShell source, CIM observations and a retained .NET process handle. It never uses PID-only `taskkill /T`. A query timeout does not kill the PowerShell helper; the caller stops and must reconcile unobserved helper completion. No late reply permits continuation.
- `createManagedGate` pins a prior gate identity and registered intent. It observes helper loss before acquisition awaits, rejects stale replies, verifies the sole surviving-helper exception, and requires exit/channel/handler/no-survivor evidence for final release. Unresolved launch intents also refuse admission.
- `createWindowsGateAdapter` bridges a pre-existing registered gate file to `managed-windows-gate.ps1`. The helper uses the Windows FileStream.Lock family, excludes Delete sharing, checks the original owner, retains its handle, and releases on owner exit or stdin EOF. Heartbeat/observation deadlines revoke permission; this is not instantaneous detection of remote exit. No automatic stale-lock deletion or gate-file replacement is performed.

## Validation boundary

Unit tests use synthetic observations. Windows tree tests run the real observation/signalling backend against only self-started, harmless Node stubs, with a separate identity allowlist before every signal. Stub children have finite self-exit deadlines. Real child survival after parent/channel closure must refuse continuation.

Gate policy/transport tests use only self-started Node helper doubles, including EOF, helper loss and pathname replacement. The PowerShell gate source is syntax-checked, but its actual FileStream.Lock exclusion and owner-death behavior are not exercised here because this step's test shutdown targets are restricted to Node stubs. Those OS-level gate claims remain subject to separate native validation. No test invokes a model, native Codex process, real installation or profile read.

S1 and survivor mutation checks operate only on isolated copies: discard the carried budget to reproduce reanchoring; discard descendant membership to reproduce parent-only false success. The candidate source is never mutated in place for those checks.

Step-2b S4/S5 mutations are historical evidence for that delivery. Step 2c deliberately changes the S4 outcome when cleanup succeeds: known orphan cleanup may now permit continuation. A still-live survivor remains forbidden. Step-2c tests run real Git init/add/commit/gc, cmd chains and intermediate Node processes in a fresh temporary repository for at least 30 seconds; fixture commits are never made in the candidate repository. They compare the old and new sampling cadence with identical current cleanup semantics, report observer counts/wall time (not CPU utilization), and retain independent ownership checks before signals. See each step's report for exact measured results.

## Accepted S13 limitation

At the default five-second delay, a short-lived intermediary can start and exit before the next sample. Its background descendant may never enter the ownership registry. The descendant can therefore survive cleanup and run alongside the next author even after an allowed observed close. Polling cannot eliminate this gap. Closing it requires kernel ownership such as a correctly configured Windows Job Object with inherited membership and no breakaway. This implementation does not supply one. See managed-continuation.md for the user-facing continuation contract.
