# Powerup gate card

The hard gates of the powerup family, one line each. This card is a reminder, not the rules: after a
compaction, re-read the skill files the reminder lists before the next action, because a summary
keeps none of them.

**Composition.** Every "if an advisor / consult mode is active" in these skills resolves to true. A
handoff prompt starts with the command that started this session (`/powerup`, `/powerup-auto`,
`/powerup-fleet`, `/queue-run`, `/queue-fleet`). The session's mode is whatever that command set, not what the
summary paraphrases.

**Enforced by the `gate.sh` hook** (every session, any repo; a denial names the way through — do
not reword a command to slip past it):
- a merge pins the reviewed head, and every verification the project has passed at it: CI checks
  where there is CI, else a `delivery/verify-head` stamp (the project's `.claude/gates.json` names
  its forge; a local `git merge` into the default branch counts where there is no forge);
- no merge of a change touching a protected path (`.claude/gates.json`, `.claude/fleet.json`, the
  project's `protected_paths`): the user merges those;
- no `git stash` (except `list`/`show`); no force push, `+refspec` or `git rebase` without asking
  the user; no `git commit` with no user.email, or, where the project sets `commit_email`, a commit
  or push authored by another email;
- in a fleet: merges only inside this slot's merge turn, of this slot's HEAD, with
  `fleet collisions` passing; declared heavy commands only under `fleet with-lock`.

**Gates the skills hold** (intent and the rule; the named section has the detail):
- **Cite nothing you have not opened in this session** (design-doc's one rule; delivery §A).
- **Design-first class ⇒ a closed design before code** (design-doc's criteria); never implement
  before the close.
- **Complete local suites of every touched package pass before a push** (delivery §B).
- **Review is `/code-review` through the Skill tool, at most medium, launched once the local suites
  pass**; one reviewer per change, resumed; one push per round; with no CI, a local suite run per
  round (delivery §B).
- **Evidence matches the clause's class**; mutation-prone clauses run `delivery/revert-check`, never
  a hand-rolled runner; the PR body carries the per-clause table (delivery §D).
- **One finding, one PR; fix the class** (delivery §C).
- **Rounds stop on no blocker findings**, never on a count or on budget (powerup).
- **A phase boundary is a handoff, not a compaction** (powerup); under powerup-auto a closed design
  and an item boundary always hand off.
- **Doctrine edits — skills, memory rules — wait for the user** (evolve).
- **In a fleet: `queue-fleet/fleet` owns every claim, lock, reservation and the merge turn**; never
  hand-roll one (queue-fleet).
