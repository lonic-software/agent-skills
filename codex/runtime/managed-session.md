# Single managed author component — step 3

Status: component integration only. B1 remains **unfinished, proceeding by operator decision**. The explicit managed CLI is now implemented in step 5; no native Codex run is validated here. Step 4 now composes this component through managed-controller.cjs; see managed-continuation.md for its separate contract and remaining prerequisites.

`runQueue(options, adapters)` selects this path **only when `options.managed === true`**. Omitted or false mode executes the original code unchanged. The existing queue CLI, checkpoint importer, operator, RPC implementation and disk-backed queue-tools server are not modified or used by this managed path.

## Host contract

The programmatic caller supplies `options.managedRun`, a separately authorized host grant: runId, versioned operator enrollment, selection, complete pinned instruction inventory, budget, explicit file task/item identity, authority/exclusions, developer instructions and a frozen launch specification. Exactly CODEX_HOME/SystemRoot/TEMP/TMP replace the author's environment; no ambient overlay. It may supply a previously established live shared run budget as `adapters.managed.runBudget`. A serialized budget is never accepted as that live object. This component does not enroll an account or access a profile.

`adapters.managed` must also supply:

- a gate with acquire/check/release, a process observe/signal backend, and registered-intent/settled-intent callbacks;
- `inspect(scope, threadResponse)` providing trusted normalized hook/instruction inventories for cwd or the loaded thread;
- synchronous `verifyInputs(boundary)` returning exactly true only when the host's complete input/profile/Git/task checks pass; boundaries are before-spawn, at-spawn, before-turn and after-exit;
- optional fixed-code audit and clock adapters; optional spawn is for controlled integration/testing, not model-provided configuration.

These are private controller capabilities, not author-supplied observations. Unknown/missing adapters refuse before native work. Native discovery completeness, actual filesystem/profile guard construction, initial owned metering and full CLI enrollment are **not implemented by a caller returning `true`**. Step 5 supplies the real host adapters and CLI/enrollment. Native discovery completeness remains an N0 prerequisite; the initial independent meter is still outside this continuation slice. No fallback invokes legacy readers to fill a missing capability. Neither this document nor a fixture's complete flags constitute native evidence.

The module registers intent before spawn, attaches the transport to that owned child, reads account/usage before thread creation and before/after the turn, compares actual thread model/provider/effort, repeats final synchronous input verification immediately before dispatch, and awaits process/streams/handlers before intent settlement and gate release. Startup account-update handling closes its exception synchronously at the first account reply. Enabled hooks, including lonic's filter, refuse before author spawn. Input verification may not return a Promise at the dispatch boundary.

## Memory-only tools and transport

The author receives dynamic lonic_context, lonic_cost_log and lonic_handoff tools over its own app-server connection. There is no child MCP queue server or descriptor-file authority. Each request must match the owning thread/turn and a fresh call ID. Reply handling binds thread/turn IDs synchronously before the next frame, including coalesced stdout chunks. Each handler is tracked by the process owner and every success/error enqueue rechecks live-generation permission.

Context refresh uses the borrowed author connection and the existing live budget authority. Only an explicit numeric usage projection and validated token counts leave the host; raw account responses, digests, enrollment, transport errors and stderr do not. Refusal/cancellation interrupts independently of a pending usage call. This first slice parks every native approval/interactive request; it grants none and makes no approval-reuse claim.

Handoff accepts exactly status/reason/itemId/context. The context allows only bounded summary/checks/findings/nextActions/sourceState; no budget, permissions, decisions, authority override or executable resumePrompt. Context is copied before awaiting freshness and returned as schema 2 from host memory. The first handoff reserves the final-call boundary; duplicate or subsequent tool calls stop. Missing/foreign handoff or incomplete turn cannot produce author-complete.

Legacy options/paths such as budgetFile, checkpoint or resumePrompt are never imported. The only model prompt is reconstructed from the captured host grant. Audit callbacks receive fixed event codes, separately from the context-only handoff. The host may retain forensic copies, but no disk copy is a source of authority. Raw frame logging is absent.

## Completion boundary

The result `author-complete` means one author, its accepted handoff and cleanup completed under these adapters. It is **not** a B1 terminal success receipt and never starts a successor (`continuationStarted:false`). Exact consumed-result bytes, successor token, owned continuation meter, post-exit snapshot adoption are provided by the step-4 controller/input/result modules where documented; step 5 now provides the explicit CLI and skill references. A failure retains recovery-required state and unresolved lifecycle/gate obligations rather than falsely reporting clean release.

Tests include synthetic adversarial schedules plus a real self-started Node protocol double using fresh pipes. That double does not run Codex, load profiles or call a model; its lifecycle backend deliberately identifies only its retained test-owned ChildProcess. Windows observation/cleanup evidence comes from step 2c, not from claiming the protocol double is an OS attestation.

## Explicit duration and polling limitation

Every caller must now supply timeoutMs explicitly: the recommended default choice is 2 hours, the hard maximum 24 hours. There is no implicit 30-second fallback. Cleanup has its own deadline. See managed-continuation.md for rationale and tests.

Five-second polling can miss a background child whose short-lived intermediary exits between samples. That unregistered child can remain alongside the next author despite an allowed observed cleanup. Only kernel-enforced membership, such as an inherited, no-breakaway Windows Job Object, can close this ownership gap. This slice does not implement one.

## Step-5 integration update

Actual host, inventory/profile/state/enrollment adapters and explicit CLI selection now exist; see managed-cli.md. Native validation remains pending. Clean author-1 stop or author-2 continue/stop returns incomplete through the same byte receipt path and releases the gate without recovery-required. Third authors remain forbidden. Editor GIT_ hints are permitted and scrubbed from local Git calls; repository/configuration redirection still refuses. Earlier component-only limitations above describe their delivery boundary, not permission to substitute a true-returning callback in production.
