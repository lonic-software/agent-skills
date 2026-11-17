# Controller powerup sessions

Use `.codex/lonic/runtime/queue.cjs` with `--entry powerup`. The historical CLI
name does not make bare powerup a queue runner. Set `--queue` to the assigned
task file and `--item-id` to a stable task ID. The host rejects a handoff that
changes this ID. Use continue at a durable phase boundary and done only when
this assigned item is complete. Never select another item.

The installed `.codex/lonic/runtime/README.md` owns configuration and operator
options. Resolve the user's task authority, an explicit current-run weekly
usage threshold or relative allowance, and run bounds before launch. Do not
infer a budget from a prior run. The existing native login is reused.

In a controller session, use lonic_queue context for measured usage and cost_log
for observed thread/turn totals. Missing prices and child events are unknown.
Context is the last reported request size, not an exact live context inventory.
A break-even value is an estimate with stated assumptions.

Use lonic_ask for user questions. A missing reply is not a decision. Native
permission requests go through the attached operator. Text answers do not bypass
native permission checks. Outside availability, park the exact question. The
host carries decisions in the checkpoint. Respect previous refusals.

Call lonic_queue handoff last, then end the turn. Preserve source state, open
findings, decisions, evidence paths and next actions. No commit is required.
The host waits 20 seconds by default; Ctrl+C cancels continuation. A saved
checkpoint alone does not authorize a new process or prove completion.

## B1 explicit managed branch

The `--managed` CLI has a separate [host contract](../../../runtime/managed-cli.md), requires `--queue-kind file` and an explicit timeout, and never inherits native approval/hook allowances from the ordinary workflow. It uses sampled account checks, bounded observed cleanup, an external intent registry, and exact-byte result receipts. A clean bounded stop is `incomplete`, not a lost handoff. This branch is experimental; B1 remains unfinished, proceeding by operator decision. Native observations cover enrollment/admission, N1 handoff and continuation, N2 cancellation plus ordinary reconcile, and N3a forced closure/survivor refusal with Node substitutes and a probe-equivalent observer. N3b produced no file change; its tool list was model-reported. Command execution is not authorized, supported or observed. See the host contract for sampled-account, cleanup, manual-recovery and profile/version limits.
