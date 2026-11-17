---
name: powerup-auto
description: "Explicit powerup queue mode: full engineering workflow for each item with queue-run budget and continuation rules."
---

# Powerup-auto

Read sibling `powerup/SKILL.md` and `queue-run/SKILL.md` in full, including the
skills powerup loads. Announce powerup, then confirm queue-run parameters.
This wrapper grants no additional action authority.

Queue-run chooses and schedules the work. Powerup governs design, authorship,
advice, delivery review, and learning. An item boundary always ends its session.
A phase boundary inside an item follows powerup's handoff criteria and also checks
usage before continuation.

Handoff prompts start with `$powerup-auto`, preserving both modes. Carry all
queue-run parameters and the ordered files needed by the next phase. Do not
replace this with bare powerup, which must stop when its current item ends.

Do not start a review round or multi-agent step that cannot reasonably fit the
remaining weekly budget. Keep unfinished loops resumable and labelled unfinished.
A context-window threshold is a separate limit and does not replace the weekly
run threshold. Missing adapters use queue-run's explicit manual fallback.

## Explicit B1 managed selection

Only when the operator explicitly selects `--managed`, use [the managed host contract](../../runtime/managed-cli.md). Require `--queue-kind file`, an explicit timeout and prior interactive account enrollment. Do not silently switch an ordinary invocation to this path or fall back after managed refusal. No enabled native hook is allowed, including lonic's own test filter. A clean `incomplete` result preserves context and does not grant a third author. This path is experimental. Narrow native observations cover enrollment, admission, handoff, cancellation, Node-substitute forced closure and ordinary reconcile; file work is unverified. Command execution is not authorized, supported or observed. All existing rules above remain the ordinary workflow.
