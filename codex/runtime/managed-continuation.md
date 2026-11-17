# Managed continuation and exact-byte result — step 4

Status: **unfinished, proceeding by operator decision**. This is a programmatic component with model-free tests. Step 5 adds the real host adapters, enrollment and explicit CLI. Native Codex validation remains pending.

## Host entry and authority

`runQueue({managed: true, managedRun: {continuation: true, ...grant}}, {managed: host})` selects the two-author component. `managed: true` without `continuation: true` retains the single-author component. Omitted/false managed mode retains the ordinary queue path. No CLI default is changed.

The controller captures the grant before awaits, creates or validates one live run-budget object and passes that same object to both authors and the owned continuation meter. Every connection compares against the same previously enrolled fingerprint. No new enrollment, disk budget import, recalculation of the relative threshold or self-approval occurs. The first accepted usage sample anchors the run; this step does not add an initial independent meter before author 1.

The gate stays held across author 1, the meter and author 2. Children borrow checks of this gate and cannot release its real helper. Each intent has a distinct role/generation and must settle after observed process/streams/handlers/tree closure. Failed or uncertain settlement retains recovery-required obligations. A run object is single-use. Process-local spent run IDs and live-budget identities also prevent recreating the same run through repeated public queue calls; recovery after a controller restart remains the registered-intent/gate obligation, with no automatic import. Its continuation capability is spent synchronously before any meter/admission/start await; refusal, failure or uncertain spawn never refunds it. There is at most one successor, and a clean second `continue` or `stop` handoff yields `incomplete`, preserving context and releasing the gate without a third author. A clean first-author `stop` has the same incomplete outcome.

The second author receives only bounded prior work context, marked as untrusted notes, along with the unchanged host authority. It gets a new owned process/connection and fresh thread; reused process IDs or thread IDs refuse conservatively. No checkpoint, saved permission or executable resume prompt is imported. Native approval/interactive requests park the run; no approval reuse is claimed.

## Admission and input state

The separate meter opens its own owned app-server connection, reads account and quota, checks the same live budget, then closes and settles. It creates no thread or turn. Author 2 cannot start until both author 1 and this meter have observed clean closure. Its admission repeats cwd hook/instruction preflight, account checks before thread, actual returned model/provider/effort, loaded-thread hook/instruction checks, account before turn and after turn, gate checks and a synchronous final input verification immediately before turn dispatch. Enabled native hooks, including lonic's own filter, remain forbidden.

`managed-inputs.cjs` supplies a concrete synchronous host guard for a deliberately narrow local Git configuration. Construct it before the run, connect `verifyInputs` to `guard.verify` and `acceptHandoff` to `guard.acceptHandoff`. It brackets two complete captures; includes HEAD, index identity/content, tracked and untracked worktree bytes, the explicit task even when ignored, and the complete enumerated instruction-source membership/content. It rejects outward paths/links, Git namespace environment overrides, redirected/common Git directories, include/extension config, incomplete instruction inventory and unstable captures. The accepted post-exit handoff may adopt the observed worktree/index baseline; instruction pins cannot be adopted or silently changed. A race between post-exit capture and adoption refuses.

The guard's `enumerateInstructions` capability must discover the complete permitted effective set, including ignored inputs and host/developer/skill content. It accepts local files inside the project and explicit host content with identity; unsupported external source layouts must refuse or be supplied as bounded host content by a trusted enumerator. `verifyProfile` is mandatory and must invoke the admitted run-local hash/size and auth metadata guard; this module never opens a profile. Its Git reads suppress global/system Git config and optional locking. A fixture's callback returning true is not native completeness evidence. Step 5 implements the real discovery/profile/enrollment adapters; their native completeness remains a prerequisite, not a waived requirement.

Synchronous capture removes an application-level await gap, not hostile concurrent filesystem races. Very large projects and unsupported Git layouts refuse this slice; a complete capture is capped at 10,000 file names. Reading an existing pathname is an input check, not result authority.

## S12: explicit author duration

Every author grant must explicitly supply `timeoutMs`. There is **no silent fallback**. The exported recommendation/default choice is **7,200,000 ms (2 hours)**; the hard upper bound is **86,400,000 ms (24 hours)**. The recommendation allows sustained coding/checking work beyond the previous 30 seconds/15-minute cap; the finite maximum limits unattended lifetime while leaving room for unusually long, operator-selected work. These are policy choices, not measured native completion guarantees. The host must consciously choose the recommendation or another finite duration (minimum 10 ms supports deterministic tests).

The deadline covers author setup, protocol waits and the turn. Each author receives its own selected duration. Expiry latches stop, interrupts an active turn independently of pending quota, and triggers bounded observed cleanup. It does not authorize another attempt. `closeTimeoutMs` separately bounds cleanup; the meter defaults to 30 seconds and permits at most 5 minutes, not an author-length wait. Backend call and observation deadlines remain separately bounded. Cancellation is always available; extending an author deadline does not extend a stuck quota lock or permit a late success.

## S13: accepted polling gap

**The five-second polling interval can miss a background process launched through an intermediary that starts and exits between observations.** Such a descendant may never be registered, so a later clean observation can overlook it. **It can remain alive alongside the next author**, despite an `allowed` observed cleanup result. More samples reduce the window but cannot close it.

This implementation is **best-effort observed tree cleanup, not proof of containment**. Closing the process-membership gap requires kernel-enforced ownership, such as a correctly configured Windows **Job Object** with inherited membership and no permitted breakaway; polling and PID/parent checks cannot supply that guarantee. This slice does not implement a Job Object. The operator has explicitly accepted this limitation; no claim of an empty kernel-owned process tree is made.

## C12: consume bytes, never reopen a result path

After final author cleanup, intent settlement and real gate release, the controller serializes the accepted in-memory handoff into a private captured byte buffer. The receipt records **length and SHA-256**. The delivery is single-use. `consume(candidate)` copies the actual delivery buffer and validates that copy synchronously; an equal-length substitution, truncation or different buffer fails. The returned buffer is the buffer that was accepted. The controller verifies it again after an optional asynchronous consumer returns, so mutation while waiting cannot be reported as success. A consumer must return the exact accepted object, not merely an acknowledgement or a forged receipt.

No filename is a trusted source, and no later reopen can recreate authority. Changing a forensic file or the original caller buffer cannot change the captured bytes. JavaScript Buffers are mutable: any later downstream recipient must use `verifyResult` on the actual bytes it consumes; a receipt is not a promise that arbitrary later edits are authentic. Length/hash are minted only for captured bytes, and success requires observed teardown plus actual consumption. Missing/delayed consumption cannot produce terminal success.

Tests use synthetic transports, isolated temporary Git repositories and three self-started Node protocol doubles. No native Codex, model or profile is used. The real Node test proves orchestration of owned local pipes, not native protocol support or kernel containment.

## Step-5 integration update

Actual host, inventory/profile/state/enrollment adapters and explicit CLI selection now exist; see managed-cli.md. Native validation remains pending. Clean author-1 stop or author-2 continue/stop returns incomplete through the same byte receipt path and releases the gate without recovery-required. Third authors remain forbidden. Editor GIT_ hints are permitted and scrubbed from local Git calls; repository/configuration redirection still refuses. Earlier component-only limitations above describe their delivery boundary, not permission to substitute a true-returning callback in production.
