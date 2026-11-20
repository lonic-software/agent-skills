---
description: Powerup + queue fleet — full-rigor powerup mode for N concurrent queue workers, one per worktree slot, coordinated by the fleet script. `/powerup-fleet start N <queue-run args>` sets the fleet up and starts one background worker session per slot; `/powerup-fleet` is what each of those sessions runs. User-invoked only.
disable-model-invocation: true
---

# Powerup-fleet

This is powerup mode running as one worker of a queue fleet. It is a wrapper, so it adds no rules of
its own beyond the composition below.

Read `${CLAUDE_SKILL_DIR}/../powerup/SKILL.md` and `${CLAUDE_SKILL_DIR}/../queue-fleet/SKILL.md` now,
in full, and follow both. That includes everything they tell you to read in turn: queue-fleet reads
queue-run. All of them carry `disable-model-invocation: true`, so reading them here is what puts
them in force. Record the run for compaction recovery as powerup says, under this command's name:
`${CLAUDE_SKILL_DIR}/../powerup/powerup-mark set powerup-fleet`.

## Two forms

As in queue-fleet ("Two forms"), with **`powerup-fleet` as the fleet's command**: setting up is
`/powerup-fleet start N <queue-run args>` and passes `--command powerup-fleet` to `fleet init`; a
worker is `/powerup-fleet` in a slot, and opens with powerup's announcement before the slot line.
Record the run under this command's name, as above, not queue-fleet's.

## Composition

- **Order of work.** Queue-fleet (and the queue-run it overrides) picks and claims the item and owns
  the merge. Powerup governs how the item is done.
- **Handoff prompts start with `/powerup-fleet`** (`/powerup:powerup-fleet` under the plugin install),
  the fleet's command. This overrides powerup's and powerup-auto's rule. The prompt names the slot, the claimed item and
  its phase, and the files the next phase reads first. Powerup's "not while the user is talking"
  holds in a slot too: an attached user who is talking gets the brief and a wait for "go".
- **Boundaries are as in powerup-auto.** An item boundary and a closed design always hand off. Any
  other phase boundary follows powerup's break-even weighing. Check usage and `fleet budget pace`
  before every handoff.
- **Rounds versus the threshold.** As in powerup-auto: convergence is not cut to save budget. If a
  round would cross the claim line, leave the item resumable and stop. Before a multi-agent step,
  reserve its estimated cost with `fleet budget reserve`.
- **Merge authority says *whether* to merge; the turn says *when*.** The `gate.sh` hook denies a
  merge outside this slot's turn.
