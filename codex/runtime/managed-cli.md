# Explicit managed CLI and host adapters

Status: **experimental; unfinished, proceeding by operator decision**. Narrow Windows native observations now cover interactive enrollment, admission, handoff/continuation, cancellation, forced closure and ordinary reconciliation. They do not establish useful file work, command execution, complete containment or general readiness. Forced closure used host-owned Node substitutes and a probe-equivalent CIM observer; it does not prove a real Codex author can create children. No automatic fallback to the ordinary queue is allowed after managed refusal. See the evidence scope below.

## Explicit entry

The existing queue entry selects this path only with `--managed`. Without that flag its original argument parsing, environment, hooks and behavior remain unchanged. This B1 option is separate from older documentation's general phrase “managed bare powerup.” The new managed host is Windows-only and was locally tested with Node 22.17.0; it uses the existing PowerShell/.NET tree and cooperative gate helpers, without a compiled helper or Add-Type.

Examples are **commands for later, separately authorized use**, not evidence of a native run. Use an already-trusted project and an existing profile. Do not point this at a new project and allow an implicit trust write. The runtime configuration must name an absolute native Codex executable and an approved model; `effort` defaults to `medium`. The OpenAI provider definition is never replaced.

```powershell
node codex/runtime/queue.cjs --managed --enroll --config C:/example/runtime.json --project C:/example/project --profile C:/example/codex-home --state-root C:/example/managed-state
node codex/runtime/queue.cjs --managed --config C:/example/runtime.json --project C:/example/project --profile C:/example/codex-home --state-root C:/example/managed-state --queue-kind file --queue task.md --authority-file C:/example/authority.txt --threshold 60 --timeout-ms 7200000
```

`--queue-kind file`, `--queue`, `--authority-file`, exactly one of `--threshold`/`--spend`, and **explicit** `--timeout-ms` are mandatory for a run. Optional managed arguments are `--item-id`, `--exclusions-file` and `--bucket`. Unknown, duplicate or ordinary-only flags refuse. Tracker locators are unsupported. No missing managed argument can silently select an ordinary run. The author duration recommendation is 2 hours, maximum 24 hours; cleanup/inspection deadlines remain separate. See managed-continuation.md.

The external state root must be outside both the project and profile, and cannot be an ancestor of the profile. A canonical project key selects one stable gate, journal and enrollment record. State directories reached through links are refused. No command writes the profile or changes hook trust/config/policy.

## Interactive account enrollment

Enrollment requires interactive stdin and a dedicated interactive stderr terminal. Only that terminal receives the recognizable, escaped account label and a request to type `yes`. Raw labels, account IDs and tokens are not written to stdout, diagnostics, the enrollment file, model input or process arguments. The two private account/usage samples must match across confirmation. Only after both reader processes settle is `enrollment.json` committed with `{schema, algorithm, fingerprint}`, while the project gate remains held; gate settlement follows. Existing enrollment is never silently overwritten. There is no `--fingerprint` approval shortcut or noninteractive yes flag.

Operator enrollment was completed before N1/N2 and the accepted runs matched the stored fingerprint. Local enrollment tests still use synthetic accounts and a simulated terminal. The client adapters do not log raw RPC frames or stderr; local native logs/SQLite are separate evidence and are not certified free of private data. A changed account requires the explicit re-enrollment procedure below; no automatic account switch or old-record deletion occurs.

Account checking is **sampled agreement**, not authenticated thread–account binding. Authors compare the once-approved fingerprint before thread creation, before the turn and after the turn; the separate meter uses the same fingerprint. One startup `account/updated` before the first account reply is permitted; a later update or a second startup update stops the generation. Changes between samples remain a limitation.

## Actual inventory and supported instruction subset

Before authors, a separately owned, model-free inspector calls `config/read` with `includeLayers:true`, `hooks/list` for the exact cwd, and uncached `skills/list`. It closes and settles before author admission. Loaded-thread checks use the author's own connection: `hooks/list` with `threadId`, `skills/list` for cwd, and the returned `thread/start.instructionSources`. Errors, warnings, missing fields, ambiguous cwd entries, unknown layer/source/trust, unknown loaded paths or changed pins refuse.

**No enabled native hook is allowed**, including lonic's own test-output filter. S20 supersedes the earlier raw-profile requirement: inventory and author processes now share the same global disabling overrides, including `features.hooks=false`, `features.plugins=false` and `features.apps=false`. Admission checks the effective response, not the mere presence of profile registrations. The supported subset requires explicit effective false values for plugin/hook/app features; missing, ambiguous or true values refuse. Nonempty plugin registration tables are allowed only with effective `features.plugins === false`. Every hook returned by hooks/list must still have `enabled === false` and complete known metadata. Every declared MCP server, including node_repl, must be explicitly disabled. OpenAI-provider redefinitions, external instruction/prompt config, selected environments and unenumerable configuration layers refuse. Enterprise/MDM layers are conservatively unsupported here. `node_repl` is disabled by launch override. These restrictions are intentional refusals, not native coverage evidence.

Implicit project-document and skill injection are disabled for authors. The host explicitly reads the selected root `AGENTS.override.md` or `AGENTS.md` in the profile and project, pins membership/identity/content, and supplies their contents with fixed base/developer instructions. All discovered skills are explicitly disabled through TOML launch values; thread skill inventory must confirm no enabled/unknown entry. `environments:[]` and `selectedCapabilityRoots:[]` are supplied. The native loaded-file list must be present and empty for this narrow explicit-text subset; an unexpected path refuses rather than being guessed safe. N0d observed 104/104 admission checks, one thread and three clean closures; the narrow loaded inventories passed. This verifies the recorded response shape and checks, not a complete hidden-prompt/tool inventory or every plugin effect. Descendant skill/instruction discovery is outside this slice, not silently unpinned.

## Profile, gate and durable intent

The run-local profile baseline is captured before the first helper/inspector process. `config.toml` uses **size + SHA-256**, so an mtime-only touch is not a change. `auth.json` uses **size + mtime only**; its contents are never opened, read or hashed. Drift latches failure; no rebaseline or retry occurs. Tests use only temporary synthetic profile directories.

The actual Windows gate adapter holds one cooperative lock across inspection, author 1, meter and author 2. Each process intent is persisted before spawn and settled only after observed closure. Persisted PID hints are never permission to kill or resume a process. An unresolved prior journal blocks the next run; there is no automatic recovery/import. On failure the owner closes its own helper channel while preserving the unresolved journal; that is not a clean release acknowledgement. A policy check precedes `.ps1` launch. **Restricted or unverifiable PowerShell policy refuses managed mode; no bypass or policy modification is attempted.**

## Results and process limitation

`done` yields `completed`. A clean author-1 `stop`, author-2 `continue` or author-2 `stop` yields **`incomplete`**, preserves the accepted context, settles the gate and reports `recoveryRequired:false`. No third author starts. Failed admission, uncertain spawn, profile drift or unobserved cleanup remain recovery-required. Both ordinary terminal statuses use the same length/SHA-256 bound consumption path.

On success/incomplete, stdout contains **exactly the accepted handoff bytes**, without an added newline. Stderr contains limitations and the status/receipt. Keep those streams separate. Exit codes: 0 completed, 2 clean incomplete, 3 reconciliation required, 4 clean pre-turn admission refusal, 1 CLI/preparation failure. A receipt authenticates the actual bytes, not a filename reopened later. A downstream consumer must verify any buffer it subsequently modifies.

**Best-effort observed tree cleanup is not containment.** Five-second polling can miss a background process launched by an intermediary that exits between samples. The unregistered process can remain alongside the next author even after an allowed close. Closing that ownership gap requires kernel-enforced membership, such as a correctly configured inherited/no-breakaway Windows Job Object. This implementation does not provide one.

## S15: synchronous input-guard cost

Each `verify()` performs two full captures: ten short Git queries plus metadata/content hashing of tracked/untracked files, the ignored task and pinned instructions, and profile checks. The supported cap is **10,000 Git-listed file names**, plus the explicitly pinned ignored inputs. Larger repositories refuse before content hashing. Capture is synchronous to avoid an application-level await between final validation and turn dispatch. It blocks JavaScript callbacks, including cancellation/heartbeat delivery, for its duration; this is not an instantaneous interruption guarantee or protection from hostile concurrent filesystem races.

On this machine (Windows, Node 22.17.0), an isolated repository with **2,000 × 4,096-byte data files (8,192,000 bytes)**, 2,001 Git-listed names and two ignored inputs measured **4,506.55 / 4,440.29 / 4,485.42 ms** per verification; median **4,485.42 ms**. Initial capture took **5,106.40 ms**. A fresh guard for a 10,001-name repository refused in **205.19 ms**. These are wall-time samples, not CPU utilization or a latency guarantee; actual workspaces and concurrent native load may differ. Evidence is managed-build-step5/input-cost.json in the build workspace. No native Codex process or real profile was involved.

Native probes require separate authorization. N0d, N1, N2 and N3b have completed within their recorded scopes; the planned four model turns are exhausted. No probe is automatically started by this document.

## S17: interactive reconciliation and re-enrollment

After a recovery-required exit, run the following in your own interactive terminal, using the original canonical project and external state root. Recovery does not read the profile, launch Codex, resume work or signal/terminate any process. It does run the existing read-only Windows process observer and cooperative gate helper, subject to the same execution-policy refusal.

```powershell
node codex/runtime/queue.cjs --managed --reconcile --project C:/example/project --state-root C:/example/managed-state
```

The command holds the same project gate, displays the unresolved journal, and checks the recorded controller and every recorded member using **PID + creation time**, never PID alone. Any live matching identity or incomplete observation refuses. A reused PID with a different verified creation time is not the old process and is never signalled. After the first absence observation, type exactly `RECONCILE` to acknowledge the displayed run. The command observes absence again and rechecks the gate and unchanged journal before archiving the previous record and atomically settling the entries. Cancellation, a failed check or a different answer leaves the obligation active. There is no automatic reconciliation and no yes/force argument. Settlement acknowledges abandoned work; it does not convert the previous result into a completed result or resume its continuation token.

New runs persist the controller identity, a write-ahead spawn-attempt marker, and each member identity as the process monitor first observes it. An explicitly never-attempted intent can be settled after the controller is absent; failure to persist the attempt marker prevents launch. **Legacy PID-hint-only entries, or an attempted spawn without a durably observed identity, cannot be reconciled by the ordinary command:** it reports `MANAGED_RECOVERY_IDENTITY_MISSING`. Do not invent creation times, delete the ledger or use PID disappearance as equivalent evidence. Those cases remain blocked pending a separately reviewed recovery procedure with trustworthy identity evidence. Even successful reconciliation covers only recorded identities: the accepted polling gap can leave an unobserved descendant alive. The prompt explicitly requires acknowledgement of this limitation; only kernel ownership would eliminate it.

After resolving any pending journal, explicitly approve the currently selected account again:

```powershell
node codex/runtime/queue.cjs --managed --reenroll --config C:/example/runtime.json --project C:/example/project --profile C:/example/codex-home --state-root C:/example/managed-state
```

First type exactly `REENROLL`, then inspect the recognizable escaped account label and type `yes`. The command does not log in or change the account itself. Two matching private samples and observed reader closure are required. The old validated fingerprint-only record is archived, and replacement is atomic under the project gate. Failed confirmation or sampling leaves the old pin intact. If persistence succeeded but final gate closure failed, treat the command as recovery-required and inspect/reconcile before another run; the new pin may already be stored. Re-enrollment is never inferred from a mismatch, and requires an existing valid enrollment. `--enroll`, `--reenroll` and `--reconcile` are mutually exclusive managed actions.

Authors, meters and inspectors receive exactly CODEX_HOME, SystemRoot, TEMP and TMP, with no ambient overlay. Windows observation/gate helpers retain their separately documented environment and use -NoProfile. No built-in OpenAI provider definition is overwritten.

## S20: effective isolation and native debt

All managed inspectors, account readers, meters and authors receive the same global plugin/hook/app/MCP and automatic instruction/skill suppression switches from managed-launch-settings.cjs. Per-path skill-disable entries remain author/meter-specific because the initial inventory must first discover their paths. This does not modify the stored profile. Registrations are not treated as proof of activity, nor is a launch argument treated as proof of disablement: config/read and hooks/list must expose the disabled state. The native effects on **plugin hooks, plugin skills and plugin-provided MCP servers are awaiting native confirmation**. A passing synthetic test proves policy/control flow only. Unknown or active returned surfaces still refuse; no silent ordinary-mode fallback exists.

The configuration/hook/skill collector executes all three read-only inspections even if a policy rule fails, and reports stable rule IDs with pass/fail only. A failed transport/safety boundary is not permission to retry or ignore cancellation. Policy errors contain no configuration value, command, account value or path. The first failed rule is the primary reason; cleanup failure is separate evidence.

## S21: clean pre-turn refusal

Before any author request is dispatched, a policy refusal can finish as status refused, with a fixed reason/ruleId and recoveryRequired:false. The recorded reader/author and all observed members must first have verified cleanup; the journal and project gate must settle. A rule rejection alone is not an unexpected process exit. No continuation or automatic retry follows. A spawned reader is closed even if its validation failed. If cleanup, profile or gate verification fails, the original rule remains visible and recoveryRequired remains true. Once an author request may have been sent, this clean-refusal path is unavailable.

## S18: noncreation and manual final recovery

The spawn-attempt marker remains write-ahead. A Node ChildProcess that has **no PID, no spawn event, an observed error, closed child and both closed output streams with no pending handlers** can durably record spawnOutcome:not-created. A missing executable exercised locally produces PROCESS_SPAWN_FAILED with this evidence. The ordinary reconciliation command can settle that record after its controller is absent; a clean reader refusal can settle it immediately under the held gate. A thrown spawn callback, missing PID alone, timeout, or failed first OS observation is not proof of noncreation. A real PID is persisted before the first observation; uncertain records are retained without blind signalling.

For an uncertain first observation or missing child identity, the final operator procedure is:

1. Preserve the entire external managed state and its SHA-256 evidence. Stop scheduling new managed runs. Do not delete/rename the journal to bypass admission or kill a reused PID.
2. Save unrelated work, then perform a **full Windows Restart** yourself. Sleep, hibernation, sign-out and a Fast Startup shutdown are not substitutes. No command in this implementation initiates a restart or changes policy.
3. Before starting any new managed work, use your own interactive terminal:

```powershell
node codex/runtime/queue.cjs --managed --reconcile --after-reboot --project C:/example/project --state-root C:/example/managed-state
```

4. Inspect the displayed obligation. The command requires a stored controller identity with native Windows creation ticks, a current OS LastBootUpTime **later** than that creation time, controller absence, the unchanged gate/journal, and a second matching boot observation. Type exactly RECONCILE-AFTER-REBOOT only if you actually performed the full restart. It archives the original record and marks the abandoned run settled with explicit reboot evidence. It never resumes old work, consumes an old token, or signals a process. Native verification of this reboot route is pending; local tests use injected boot observations.

This is an explicit manual last resort, not automatic recovery or a PID-only override. If the historical journal lacks even a trustworthy controller creation identity, the boot observation is unavailable, policy blocks the helper, or clock/boot evidence is inconsistent, this command refuses. In that older-data case the administrative last resort is a full restart plus a separately retained pre-restart archive and independent operator verification that the old generation cannot remain; then select a **new, explicitly named external state root** and perform fresh terminal enrollment. Keep the old root archived and blocked; never import its intents/tokens or treat its work as completed. Do not take this last resort without that independent evidence. It is not implemented as an automatic CLI bypass.

## S23: explicit instruction sources and shell environment policy

CFG_INSTRUCTIONS requires instructions, developer_instructions, compact_prompt, experimental_compact_prompt_file and model_instructions_file to be absent, null or an empty string. Known empty fields are checked by exact name. Unknown keys matching instructions|prompt|environment still refuse, including empty unknown fields. Environments are evaluated separately by CFG_ENVIRONMENTS. The only additional reviewed exception is shell_environment_policy (null or object); it is not a model instruction source.

Schema evidence: the saved Codex 0.167.0 ConfigReadResponse schema explicitly lists instructions, developer_instructions and compact_prompt. Its Config has additionalProperties:true and does not enumerate the two file-loading fields or shell_environment_policy. The file loaders are explicitly denied by the operator's managed contract; the shell policy is an explicit operator-approved exception, not an inference from that incomplete generated schema. No other instruction-loading config key was established by this schema review. Unknown matching fields fail closed. Evidence path in the design workspace: native-probes/m2/schema/v2/ConfigReadResponse.json, SHA-256 4ec77e1a3eed746037149799c3b6bb8fe7b4b593e5930fc9f410e6282de9df50.

The entire effective configuration and every layer's configuration are already canonicalized into configDigest. Shell policy content is included, never redacted from the pin. An effective or layer shell policy change therefore refuses revalidation with CONFIG_PIN. Key reordering alone does not change the canonical hash.

This content pin proves stability, not shell safety. Environment settings can affect executable lookup and shell startup (for example PATH or BASH_ENV), even though the app-server itself receives only four host variables. The native sandbox and accepted best-effort process ownership limits still apply. A stricter future policy could permit inherit:none, forbid set entries that affect shell startup or executable lookup, and allow only explicitly reviewed variables. That would reject some Desktop profiles and requires an explicit compatibility decision; it is not silently imposed by S23. N0d and later author probes accepted the recorded inventory/configuration; shell execution semantics were not exercised and remain unobserved.

## S22: bounded heartbeat sharing and remaining process-tree uncertainty

A foreground gate check or release can overlap the periodic heartbeat. Previously that pending reply caused immediate GATE_OBSERVATION_BUSY, which the outer gate reported as failed observation or release. The adapter now shares that single bounded ping promise; release disables new heartbeats before joining it. The response still has to match the registered intent and event, the helper must remain live, and normal pathname/identity and final closure checks still apply. Missing responses still fail at the existing timeout. No ownership or refusal condition was relaxed, and no timeout was enlarged for this race.

Local delayed-reply Node fixtures reproduced both false refusals, and then passed with one request each after this change. This establishes the race, not its retrospective responsibility for every earlier generic MANAGED_RUN_FAILED result. The earlier process-tree PROCESS_OWNERSHIP_UNCERTAIN failures remain a distinct investigation: observations are not atomic and unknown ancestry still refuses. Successful repeated local runs cannot prove that intermittent tree failures are gone.

Saved native Codex startup was about 9–10.5 seconds. Managed reader initialization already allows 60 seconds and author/meter RPC defaults allow 30 seconds; process start/identity observation is a separate bound. N0c retains 60 seconds for initialize, 45 seconds per subsequent RPC, 30 seconds for start observation, 60 seconds for cleanup, and 360 seconds overall before cleanup. Local synthetic helper timings do not justify shrinking native startup budgets. No native startup was performed for S22/S23.

## S24: hash-confirmed configuration names and builtin-context switches

The saved N0b configuration contains 106 effective root keys, including 67 hash-labelled names. Offline recovery matched SHA-256(JSON.stringify(name)) against the pinned 0.167.0 executable's identifiers: 42 matched whole identifier runs; the remaining 25 matched slices of concatenated Rust identifier tables. All 67 names were recovered. The 19 effective feature keys and all four layers' root/feature names were also resolved. No configuration value or value hash was decoded. The executable pin is edfdd48f8b458af0906e507b4cb05217b326c3d6e515e9f024e05e3b8d650f70. This proves identifier identity, not behavior.

The managed-config-keys catalog admits only schema-declared or hash-confirmed effective/layer root names and reviewed feature names (plus the separately specified environments key). The CFG_KEYS catalog was derived from one observed Desktop profile and Codex 0.167.0; it is not a universal configuration catalog. CFG_KEYS rejects unknown names, including unresolved key-sha256 labels, even when the value is empty. A Codex update that changes the catalog, required fields or response shapes can therefore refuse managed startup until reviewed; a version string alone is not an automatic rejection gate. This is version-specific and deliberately rejects newly introduced keys until reviewed. Nested registry identifiers such as project paths/plugin names remain opaque, content-pinned map keys; they are not promoted to configuration setting names. Their hashed names are retained in the synthetic structural fixture. Existing disabled-surface and inventory checks still apply.

The following decisions are conservative interpretations of the verified identifier and observed Boolean type, not claims that native prompt suppression has been observed. The slice permits host-supplied and explicitly enumerated sources only. Every managed launch therefore requests all five switches false; CFG_BUILTIN_CONTEXT_DISABLED requires explicit Boolean false in the effective response (missing/null/string/true refuse). Lower layers can retain overridden preferences; all effective and layer contents remain hashed.

| Verified key | Interpreted inclusion control and managed decision |
|---|---|
| include_collaboration_mode_instructions | Potential native collaboration-mode instruction text outside the explicit host source set: request false and require false. |
| include_environment_context | Potential native environment/cwd context beyond the host-captured context: request false and require false. |
| include_permissions_instructions | Potential implicit permission-description instruction text: request false and require false. No sandbox or approval parameters are changed by this work. |
| include_apps_instructions | Potential app/tool instruction text despite disabled app surfaces: request false and require false, in addition to features.apps=false. |
| include_environment_context_time | Potential changing clock/time context outside the pinned host sources: request false and require false. |

Native effectiveness, and whether any additional builtin text is still emitted, remain unproven. A matching config response is necessary evidence, not proof of a complete prompt inventory. The known experimental_realtime_ws_backend_prompt and experimental_realtime_start_instructions names are additionally classified as empty-only text sources; their actual realtime behavior is not asserted. These two names were absent from the narrow generated Config property list but hash-confirmed in the executable.

Offline replay preserves the observed key membership and types, including effective features and all layer configurations. Every value is synthetic, and the five inclusion controls use the proposed disabled state. Passing replay is not a claim that the earlier native values passed or that future override application is guaranteed. Unknown root/feature/layer names are explicitly tested to refuse. No native evidence file is used as runtime policy data.
# Project trust, host orientation and notification audit (S28/S26)

## Experimental scope and native evidence (S32/S39 operator decision)

This PR retains `environments: []` with no turn override. Command execution is
**not authorized, not supported and not observed** in this slice. This is a host
instruction boundary, not proof that command tools are absent or cannot run.
`workspace-write` and `approvalPolicy: never` are requested policies, not proof
that all in-workspace execution is blocked. Missing/refused tools require a stop
handoff; exposed tools do not grant permission or justify an alternate route.

Accepted Windows evidence in the separate design workspace:

| Surface | Observation and limit |
| --- | --- |
| Enrollment | Operator interactive enrollment completed; fingerprint-only stored record verified before accepted N1/N2 runs. Sampled account agreement remains non-atomic. |
| Admission | N0d: 104/104 checks, one thread, three clean closures. This is the observed inventory subset, not a proof of complete hidden prompt/tool suppression. |
| Handoff | N1: in-memory handoff, one fresh-author continuation and exact-byte delivery. No file-work demonstration. |
| Cancellation | N2: interruption precedes delayed quota delivery, no successor or late success. Manual reconciliation remains required. |
| Forced closure | N3a r2 forced case: four registered node.exe/conhost.exe members, forced-after-completed-turn, clean. Node substitutes, production manager/signalling, probe-equivalent CIM observation with names; not Codex child-creation evidence. The separate r3 survivor case is now observed: detached target survived forced parent closure, its signal was deliberately withheld, the manager refused with recoveryRequired:true, and scoped cleanup completed. Its negative fixture journal remains unresolved evidence; this is a controlled withheld-signal case, not proof of resistance to an actual kill. |
| Reconciliation | Operator N2 --reconcile returned reconciled/count 1, settled the journal and archived its predecessor. No claim about the separate after-reboot route. |
| File work/tools | N3b: one turn, no fileChange, commandExecution or approval request, no created file or worktree change. The model reported applyPatch: refused and listed exec_command, write_stdin, functions.exec and apply_patch. This is a model-reported list, not a server tool inventory or a demonstrated patch/exec call. |

Evidence paths: native-probes/n0d, n1, n2, n3/evidence-a-r2, n3/evidence-a-r3 and n3/evidence-b in
the design workspace; operator reconciliation is additionally reported and its
settled/archive records inspected there. Earlier U5 writing used a different
launch configuration. File writing did not occur in N3b; productive file work
and command execution remain unverified. Native logs remain local evidence,
not inputs copied into this source repository.

## Interrupted work and recovery (S34 operator decision)

This PR deliberately retains mandatory manual reconciliation after an operator
cancellation during an unfinished turn, even if every recorded process and
stream has closed: recoveryRequired:true and an unresolved journal remain.
This conservative policy is an accepted operator decision, not a claim that
cleanup failed. Do not delete the journal or retry automatically. Interactive
--reconcile checks recorded identities are absent, requires exact RECONCILE,
archives the old journal and acknowledges abandoned work. It never signals a
process or resumes the old turn. A clean-cancel settlement path is not implemented
or included in this PR. S37 displays the unresolved JSON once before confirmation.

## Known process-churn reliability limit (S35 / remaining S22)

Rare operationally unwarranted PROCESS_OWNERSHIP_UNCERTAIN stops can occur during
process churn, even with time remaining and later observed clean teardown. The
recorded branch compares a changed identity before a positive absence sample;
the underlying PID-reuse/non-atomic-observation event is not fully established.
The guard fails safely and retains recovery rather than guessing ownership.
This is an open reliability limit, not a relaxed safety check or a fixed flake.
It can waste a real turn and require manual reconciliation. Passing repeated
tests does not remove the risk. Polling can also miss short-lived ancestry; only
stronger kernel membership can close that separate containment gap.

Historical validation recorded two failures in nine full-suite runs, with two
different signals: an identity change before a positive absence observation,
and three consecutive failed monitor samples (none marked slow). These do not
establish one shared low-level cause or a production failure rate. The single
30-second Git/cmd load test is now an opt-in diagnostic, skipped by default with
an explicit S35 message; all other tests remain enabled as before. Ownership and
absence checks, fixture cleanup and assertions are unchanged. To run it from
the source repository in PowerShell, preserving the previous environment value:

```powershell
$previousLoadTest = $env:LONIC_TEST_PROCESS_LOAD
try {
  $env:LONIC_TEST_PROCESS_LOAD = '1'
  node --test --test-reporter=tap tests/managed-process-load.test.cjs
} finally {
  $env:LONIC_TEST_PROCESS_LOAD = $previousLoadTest
}
```

Only the exact value `1` opts in; the test requires Windows. Record its result
separately from the default suite, including failures. Skipping this diagnostic
does not fix the reliability limit or certify containment.

Managed execution and interactive account enrollment require CFG_PROJECT_TRUSTED
to pass on the effective config/read response. Trust must cover the exact project
path; trusting only its parent folder is not sufficient. This Windows slice accepts only
an explicit entry for the exact canonical project, with an absolute backslash
path key and exactly `trust_level: "trusted"`. S33 compares Windows keys without
case sensitivity: original-case and lowercase spellings are accepted, and
case-only duplicate entries must all be valid and trusted. Conflicting entries
refuse regardless of insertion order. N0d observed lowercase spelling; the S33
operator report additionally observed original casing. This is not a general
path-normalization guarantee for other spellings or platforms. Missing entries,
ancestor-only trust, non-case aliases, unsupported shapes and unknown values refuse before any thread
or enrollment prompt. No declaration file substitutes for the native response.
The ordinary refusal is clean: CFG_PROJECT_TRUSTED, closed intent and no recovery
required, provided process/profile/gate cleanup itself succeeds. The CLI explains
that the operator must establish trust separately; it never edits trust/profile
configuration. A cleanup failure still requires reconciliation.

The production developer instruction now includes the exact canonical cwd and
fixed host text describing workspace-write / approvalPolicy never. The host
grant limits work to the project task, forbids writes to protected metadata and
host/profile state, network access, escalation, extra agents and background
processes. A narrower task grant cannot expand those limits. These are explicit
host instructions; they do not claim additional kernel enforcement or describe
every native tool. The entire generated prefix, including cwd, participates in
the host:developer content hash alongside separately pinned root instructions.

All managed author/meter/inventory notifications call the same payload-free
audit. The default host appends only event type and method name to the external
project-state `notifications.jsonl`; an injected audit receives the same record.
It never receives notification params, account values or thread identifiers.
JSON escaping prevents control characters in a method name becoming log lines.
The account/updated startup-window/stop policy is unchanged. Other notifications
are audited without stopping the run. Audit sink failure is best-effort and does
not turn a progress event into an authorization or stop; it can leave an audit
gap. The other existing transport/admission failures remain fatal.

## Enrollment label and additive audit (S30/S31)

The confirmation question shows the recognizable account email only. No workspace
name/row is promised or synthesized: the supported account response does not
supply a verified workspace label. Exact lowercase yes is still required; only
the fingerprint is stored. An injected audit observer supplements notifications.jsonl
instead of replacing it; local notification records remain method-only.
