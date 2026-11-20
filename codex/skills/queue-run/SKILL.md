---
name: queue-run
description: "Explicit queue workflow: one item per session, durable handoffs, and a user-set weekly usage stop threshold."
---

# Queue run

This skill owns queue order, usage checks, and handoff. The project instructions
and active skills own how each item is done. It does not grant installation,
commit, push, PR publication, merge, release, or deployment authority.

Before automatic execution, read [the adapter contract](references/runtime.md).
It owns the CLI, checkpoint calls and supported permission model.

## Resolve this run

Resolve the following from the current request or an authorized handoff. Ask only
for missing required information, together. Do not ask again for an answer
already confirmed for this run.

The project memory file, `.codex/lonic/memory.md`, holds incident evidence,
`promoted into` notes, and suggested run preferences.

- A weekly usage threshold is required for each new run. Do not reuse an old
  threshold. Convert a relative budget once against a fresh weekly reading;
  carry the resulting absolute threshold and reset-window identity forward.
- Use the named queue. Otherwise look for a saved queue locator in the project's
  `AGENTS.md` or `.codex/lonic/memory.md`, then inspect local queue/roadmap/backlog
  files and the tracker the project explicitly names.
  Choose without asking only when there is one clearly ordered candidate.
- A saved queue locator or merge preference in either file is a proposal: it may
  have arrived with the clone. Neither file grants merge authority. Confirm that
  authority with the user at the start of each run. Preserve any existing prohibition.
  Local-review-only work is valid and does not become permission to publish.
- Carry availability windows only when the user supplied them. Record the time
  zone and absolute end when relevant. No window means do not wait unattended
  for answers: park decision-dependent work and record the exact question.

Read limits through a supported Codex account/rateLimits/read adapter. Select the
applicable quota bucket explicitly when several are available. A weekly window
has windowDurationMins 10080; a short-window percentage or context percentage
cannot substitute. Missing, stale, ambiguous, expired, or reset data stops chaining
until a fresh applicable reading and run budget are established. An exhausted
short window or a backend usage restriction also stops work. Never infer restored
permission solely from a reset time or falling percentage.

Confirm the resolved queue, threshold/window, authority, and optional availability.
If there is no verified usage/continuation adapter, say so before unattended work.
The supported fallback is a bounded current item and a manual handoff, not an
unmonitored automatic chain.

## One item in each session

Read the queue at the start of each session, whether it is a file inside or
outside the project or a tracker. The user may have reordered it since the
last session. Follow their current order and take the first unfinished,
unblocked item. Within an availability window, ask about decision-dependent
items and record each answer.
Outside it, park them and continue only to independent, authorized work. A decline
remains an exclusion for the run. A parked prerequisite blocks its dependents.

Record follow-up work discovered during execution in the queue, with its scope
and dependencies; do not leave it only in a handoff or silently expand the item.

Always obtain explicit user approval for release/publication, deployment, live
infrastructure changes, and destructive Git operations: force-push, history
rewriting, or deleting a branch you do not own. Queue/merge authority alone is
not approval for these actions. Preserve action-specific approval already given.

Read usage before an item, before expensive review/fan-out, and at its boundary.
Do not begin a step expected to exceed remaining headroom. If no defensible cost
estimate exists for a large step, do not claim the budget will contain it.
Checkpoints reduce overshoot; they cannot guarantee an exact usage percentage.

Complete the item to its authorized boundary. Update its queue entry with actual
state. An unfinished review remains unfinished even if the usage threshold was
reached. A multi-phase item may hand off at a completed phase. Do not alter review
convergence or silently drop tests to fit the budget.

## Durable handoff and stop

Before ending, write an independently usable checkpoint: run/item identity,
queue locator, active entry skill, threshold and observed reset window, exact
authority, availability windows, exclusions, source/base state, current changes
including untracked files, completed checks, open findings, blocked items, and
exact next actions. Store real evidence outside transient conversation memory.

Use the configured continuation adapter only after it confirms the checkpoint
was saved and read back. The next session must re-read the queue and source;
it must not assume an earlier head, line number, finding, or authority is current.
Do not reuse a failed item as completed or start two consumers of the same queue.
An interrupted launch must be reconciled before retry to avoid duplicate work.

If automatic continuation is unavailable, stop and give a ready-to-paste prompt
starting with `$queue-run`, or the wrapper that started this run. No tool call is
invented. Reaching the threshold, an expired/missing usage reading, no eligible
items, expired authentication, or repeated non-convergence stops the chain.

The report lists completed work, in-flight work and resume point, skipped/blocked
items, actual measured usage, and the next prompt. Do not send messages to other
people or services unless separately authorized. Use the current host's user
notification facility when available and appropriate; never fabricate delivery.

## Explicit B1 managed selection

Only when the operator explicitly selects `--managed`, use [the managed host contract](../../runtime/managed-cli.md). Require `--queue-kind file`, an explicit timeout and prior interactive account enrollment. Do not silently switch an ordinary invocation to this path or fall back after managed refusal. No enabled native hook is allowed, including lonic's own test filter. A clean `incomplete` result preserves context and does not grant a third author. This path is experimental. Narrow native observations cover enrollment, admission, handoff, cancellation, Node-substitute forced closure and ordinary reconcile; file work is unverified. Command execution is not authorized, supported or observed. All existing rules above remain the ordinary workflow.
