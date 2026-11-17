# Powerup gate card

The hard gates of the powerup family, one line each. This card is a reminder, not the rules: after a
compaction, re-read the skill files the reminder lists before the next action, because a summary
keeps none of them.

**Composition.** Every "if an advisor / consult mode is active" in these skills resolves to true. A
handoff prompt starts with the command that started this session (`/powerup`, `/powerup-auto`,
`/powerup-fleet`, `/queue-run`). The session's mode is whatever that command set, not what the
summary paraphrases.

**Gates.**
- **Cite nothing you have not opened in this session** (design-doc's one rule; delivery §A).
- **Design-first class ⇒ a closed design before code** (design-doc's criteria); never implement
  before the close.
- **Complete local suites of every touched crate or package pass before a push** (delivery §B).
- **Review is `/code-review` through the Skill tool, at most medium, launched beside CI**; one
  reviewer per change, resumed; one push per round (delivery §B).
- **Merge only on green on the final head**, read with `delivery/wait-pr-ci` and the forge's full
  check list right before merging (delivery §B).
- **Evidence matches the clause's class**; mutation-prone clauses run `delivery/revert-check`, never
  a hand-rolled runner; the PR body carries the per-clause table (delivery §D).
- **One finding, one PR; fix the class** (delivery §C).
- **Rounds stop on no blocker findings**, never on a count or on budget (powerup).
- **A phase boundary is a handoff, not a compaction** (powerup); under powerup-auto a closed design
  and an item boundary always hand off.
- **Doctrine edits — skills, memory rules — wait for the user** (evolve).
- **In a fleet: `queue-fleet/fleet` owns every claim, lock and the merge turn**; no `git stash`, no
  merge outside the turn, heavy commands only under `fleet with-lock` (queue-fleet).
