# Codex queue adapter

## Installation lookup (Codex 0.167.0 port)

Resolve RUNTIME to the project's .codex/lonic/runtime first, otherwise
CODEX_HOME/lonic/runtime (CODEX_HOME defaults to the OS home/.codex).
Use the selected absolute path, quoted as a separate shell argument.
The read-only helper at either installation, resolve-installation.cjs, accepts
PROJECT and queue or evidence and prints the selected runtime/config paths.
Without --config, global lonic/runtime-config.json is read first and project
.codex/lonic/runtime-config.json overrides its top-level fields. Arrays/objects
replace; invalid project configuration refuses. Explicit --config is standalone.
Do not infer an account, model, budget or authority from installation scope.


Use this reference when starting or continuing an automatic queue. The installed
CLI is `RUNTIME/queue.cjs`; its configuration is resolved as described above. It uses the current native login.

Inside an existing controller session, the lonic_queue MCP tools are present.
Use context for measured usage and handoff for the final durable checkpoint.
Do not start another queue controller from that session.

Outside a controller session, resolve the required parameters, save the exact user
authority in a UTF-8 text file, and save standing exclusions as a JSON string
array. Creating those records does not add authority. Example syntax only:

```text
node RUNTIME/queue.cjs --project ABSOLUTE_PROJECT_ROOT --queue ABSOLUTE_QUEUE_PATH --authority-file AUTHORITY_FILE --exclusions-file EXCLUSIONS_FILE --entry queue-run --threshold USER_PERCENT
```

For powerup-auto, pass --entry powerup-auto. Use --spend USER_PERCENT instead of
--threshold only when the user specified a relative allowance for this run.
There is no default threshold. Use --bucket when account data has multiple quota
buckets. Optional --max-steps bounds the number of sessions (default 20), and
--timeout-ms bounds each session (default 7200000 (2 hours), at most 43200000 (12 hours)).

The controller checks actual account usage, loads the project entry skill
explicitly, and starts one fresh native session per item or completed phase.
It holds one project lock. A second controller for that project is refused.
It checks and claims the saved checkpoint before starting another session. The
whole checkpoint, including unresolved findings and source state, is supplied
as context, not new authorization. The new session must still re-read source.

Use --interactive from an attached terminal to answer native permission requests
and lonic_ask questions. There is no default approval. Each approval applies to
the displayed request; permission-profile grants last at most the current turn.
Use --availability-file for optional IANA windows and --operator-timeout-ms to
bound waiting. Outside availability or after timeout, park decision-dependent
work. Unattended mode uses approvalPolicy never. Do not discard requested windows.
The installed runtime README defines the file format.

The default handoff countdown is 20 seconds; Ctrl+C cancels before the next
session. --handoff-delay-ms can explicitly change it (0..60000). Bare powerup
uses the same controller with --entry powerup and a fixed --item-id. It never
selects another queue item. Its skill reference defines that launch contract.

handoff accepts status continue, stop or done, a reason, itemId, resumePrompt,
sourceState, completedChecks, openFindings, blockedItems and nextActions. Resume
prompts start with the entry skill. Include an explicit final-report next action
for done/stop. Run identity, authority, exclusions and budget come from the host
and cannot be expanded by the worker. Call handoff last and end the turn.

A failed/interrupted session, missing handoff, unhandled interactive request, exhausted
budget or changed account/window stops chaining. The result records native
thread IDs and the exact resume point. Reconcile the old process, queue and
source before a retry. Do not delete a checkpoint claim to replay work blindly.
The controller does not automatically recover a crashed run.

This is the upstream queue's WEEKLY account threshold. It is separate from a
context threshold or a user's five-hour review limit. Measurements can lag and
other sessions share the allowance; an exact stop percentage is not guaranteed.
Exit 0 means the queue reported completion; 2 means stopped/incomplete; 1 means
an invalid launch. A successful handoff does not prove the work was correct.

## B1 explicit managed branch

The `--managed` CLI has a separate host contract at RUNTIME/managed-cli.md, requires `--queue-kind file` and an explicit timeout, and never inherits native approval/hook allowances from the ordinary workflow. It uses sampled account checks, bounded observed cleanup, an external intent registry, and exact-byte result receipts. A clean bounded stop is `incomplete`, not a lost handoff. This branch is experimental; B1 remains unfinished, proceeding by operator decision. Native observations cover enrollment/admission, N1 handoff and continuation, N2 cancellation plus ordinary reconcile, and N3a forced closure/survivor refusal with Node substitutes and a probe-equivalent observer. N3b produced no file change; its tool list was model-reported. Command execution is not authorized, supported or observed. See the host contract for sampled-account, cleanup, manual-recovery and profile/version limits.
