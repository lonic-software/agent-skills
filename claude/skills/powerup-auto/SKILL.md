---
description: Powerup + queue run — full-rigor powerup mode, working through the project's queue unattended, one item per session with handoffs, until weekly usage reaches the threshold set for this run. Args as for queue-run, e.g. `/powerup-auto stop at 60%`. User-invoked only.
disable-model-invocation: true
---

# Powerup-auto

This is powerup mode running the queue-run chain. It is a wrapper, so it adds no rules of its own
beyond the composition below.

Read `${CLAUDE_SKILL_DIR}/../powerup/SKILL.md` and `${CLAUDE_SKILL_DIR}/../queue-run/SKILL.md` now, in full, and
follow both. That includes everything powerup tells you to read in turn. Both skills carry
`disable-model-invocation: true`, so reading them here is what puts them in force. The arguments of
this command are queue-run's arguments.

Open with powerup's announcement, then queue-run's parameter confirmation, in that order.

## Composition

- **Order of work.** Queue-run resolves the run parameters and picks the item. Powerup governs how the
  item is done: design-first classification, delivery disciplines, review loops, advisor use, and the
  evolve loop.
- **Handoff prompts start with `/powerup-auto`** (`/powerup:powerup-auto` under the plugin install), never `/powerup` or `/queue-run` alone. This overrides
  powerup's "the prompt starts with `/powerup`". The prompt carries queue-run's run parameters (§4)
  *and* powerup's content: the files the next phase reads first, in order.
- **Two kinds of boundary:**
  - An **item boundary** (an item finished or merged) always ends the session: hand off or stop
    according to the usage check. Do not weigh it, because the usage checkpoint lives there.
  - A **phase boundary inside an item** (a design closed, a slice merged with more slices to go)
    follows powerup's break-even weighing. When it does hand off, check usage first, because the stop
    rule applies at every handoff.
- **Rounds versus the threshold.** Powerup's convergence rule is not cut to save budget. If finishing
  the current review loop would likely cross the threshold, don't start the round. Leave the item
  resumable at the round boundary, with the open findings written down, and stop. A half-converged
  round is never treated as converged.
- **Fan-out pricing.** Price every multi-agent step (design-attack, grounding, high-tier reviews) in
  weekly percent against the remaining headroom to the threshold before launching it.
