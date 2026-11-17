---
description: Powerup + queue fleet — full-rigor powerup mode for N concurrent queue workers, one per worktree slot, coordinated by the fleet script. `/powerup-fleet start N <queue-run args>` sets the fleet up once; `/powerup-fleet` in each slot's session runs a worker. User-invoked only.
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

- **`/powerup-fleet start N <queue-run args>`: setting up, run once by the user from the main
  checkout.**
  1. Resolve queue-run §1 once, with the user: threshold, queue, merge authority, windows. Use
     N = 2 unless the user names another count.
  2. Run `${CLAUDE_SKILL_DIR}/../queue-fleet/fleet init --workers N --threshold … --queue …
     --merge-authority … [--windows …]`. If it refuses for a missing project config, show the user
     the template it printed, propose a filled-in config from the repository, and stop until they
     accept it and it is committed.
  3. Init creates the slot worktrees, detached at the main ref, under the config's in-repo worktree
     root, and prints one `cd <slot> && claude` line per slot. Relay those lines to the user, then
     stop. This session works no item.
- **`/powerup-fleet` (no args), or a handoff prompt that starts with it: a worker, in a slot.** Open
  with powerup's announcement and one line naming the slot. Then follow queue-fleet: `fleet whoami`
  first, then the item loop.

## Composition

- **Order of work.** Queue-fleet (and the queue-run it overrides) picks and claims the item and owns
  the merge. Powerup governs how the item is done.
- **Handoff prompts start with `/powerup-fleet`** (`/powerup:powerup-fleet` under the plugin install).
  This overrides powerup's and powerup-auto's rule. The prompt names the slot, the claimed item and
  its phase, and the files the next phase reads first.
- **Boundaries are as in powerup-auto.** An item boundary and a closed design always hand off. Any
  other phase boundary follows powerup's break-even weighing. Check usage and `fleet budget pace`
  before every handoff.
- **Rounds versus the threshold.** As in powerup-auto: convergence is not cut to save budget. If a
  round would cross the claim line, leave the item resumable and stop. Before a multi-agent step,
  reserve its estimated cost with `fleet budget reserve`.
- **Merge authority says *whether* to merge; the turn says *when*.** The `gate.sh` hook denies a
  merge outside this slot's turn.
