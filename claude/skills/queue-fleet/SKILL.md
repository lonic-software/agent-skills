---
description: Queue fleet — N queue-run workers in one repository at once, each in its own worktree slot, coordinated by the `fleet` script (claims, locks, a FIFO merge turn, a shared budget). Read by /powerup-fleet; not invoked on its own. User-invoked only.
disable-model-invocation: true
---

# Queue fleet

Several sessions work one project's queue at the same time, each in its own worktree (a **slot**).
This skill is the protocol between them. It is queue-run with overrides: read
`${CLAUDE_SKILL_DIR}/../queue-run/SKILL.md` in full and follow it, except where a section below
replaces a part of it by name.

**Intent.** N workers should finish N items in roughly the time one takes, with no worker ever
undoing, racing or second-guessing another. Two things make that safe. First, **every shared
decision is an atomic operation of one script**, `${CLAUDE_SKILL_DIR}/fleet`, never a convention
the sessions keep by being careful. Second, **the slot owns its work**, so a crash or a handoff in
one slot never moves work between slots. There is no orchestrator session: the script's state
(`$(git rev-parse --git-common-dir)/fleet/`) is the coordinator, and every worker reads it.

Traps seen, as evidence for the rules below:
- two sessions sharing one tree popped each other's stash;
- a merge rebased a reviewed branch and invalidated the review;
- two branches took the same next serial number;
- a lock stolen on a timeout killed a suite that was only slow;
- a 5-hour window ran out mid-merge and left a PR half-landed.

## Gates (each names its script)

- **`fleet whoami` at every session start, before anything else.** It registers this process
  (`$CLAUDE_PID` and its start time) as the slot's owner. It refuses when another live process owns
  the slot: then stop and tell the user. A new process in a slot whose owner is gone **adopts** it,
  with its claims.
- **`fleet claim <item> --area <area> --usage <weekly %>` before starting an item.** It refuses an
  item another slot holds, an area another slot is working, an excluded item, a halted fleet, and
  any claim at or over the claim line (the threshold minus 3% per live worker, minus the other
  slots' reservations). `fleet release <item>` at the item's end. Claims are **never reassigned**:
  only that slot's next process adopts them. A refused claim is not an error to work around; take
  the next eligible row.
- **Heavy commands run as `fleet with-lock suite -- <command>`.** The project config declares which
  commands are heavy and their bound. The lock belongs to the wrapper process, so it ends when the
  command does, and it is broken only when that process is gone, **never on elapsed time**. Put the
  same wrapper in every reviewer brief: the reviewer runs tests in your tree.
- **Merging happens only inside the merge turn:** `fleet turn enter`, then `fleet turn wait` until
  it prints `your turn`. The turn is a FIFO ticket queue. `fleet turn leave` when done, or
  `fleet turn leave --requeue` to go to the back.
- **`fleet reserve <resource>`** for anything serial the config declares. A `pool` value is reserved
  at first use and kept by the slot. A `counter` (the next number of a numbered series) is assigned
  **only inside the merge turn**, from the main ref, because only there is the main ref final.
- **`fleet budget reserve <pct> --usage <weekly %>`** before any step expected to cost more than
  about 1% of the weekly limit; `fleet budget release` after it. `fleet budget pace --five-hour <%>`
  at every item boundary and before any expensive step: when it says wait, release your locks, leave
  the turn queue if you are not in a merge, and wait for the window's reset plus your slot's stagger.
- **`fleet halt <reason>`** on infrastructure or authentication failure (CI down, the forge or the
  queue's host refusing credentials), so no slot spends budget against it; then stop and notify.
- **The `gate.sh` hook enforces the rest.** In every session it denies a merge without its
  evidence, `git stash`, and force pushes and rebases; while a fleet exists it also denies a merge
  outside this slot's turn and a declared heavy command outside `fleet with-lock`. A denial is the
  protocol working: do not reword the command to slip past it.
- **Never hand-roll a fleet operation.** Never edit the state folder, and never write a lock, claim
  or queue by hand. If the script cannot express what you need, stop and tell the user.

## The merge turn (replaces how queue-run merges)

Review, rounds and fixes all happen **before** `turn enter`; never run a review round inside the
turn. Inside it:

1. Read the change's state back — from the forge, or from the default branch where there is none.
   If an earlier holder of this slot left it half-merged, finish from what is there.
2. **Fast path:** if the branch already contains the default branch's tip, go to step 5.
3. Otherwise **merge the default branch into yours, never rebase.** A rebase rewrites the reviewed
   commits. Run the project's declared regeneration for its mechanical files, then assign any
   counters (`fleet reserve`) and fix their uses. Push, where there is a forge.
4. A **mechanical update** (a merge with no conflict outside the declared mechanical files, plus the
   regeneration and counter fixes) needs no new review (delivery §B). **A conflict in a
   non-mechanical file, or any real red, means leave the turn:** `fleet turn leave --requeue`, fix
   and review outside it, come back.
5. **Verify the merged head the project's way.** With CI: wait with `delivery/wait-pr-ci <PR>
   <deadline>` (GitHub Actions) or the forge's equivalent. A queued run is not a stuck one: pass a
   deadline long enough for the fleet's CI load. With no CI: run the complete local suites on that
   exact head under the suite lock — `fleet with-lock suite -- delivery/verify-head -- <suites>` —
   which stamps it. Then confirm the default branch's tip is still the one you merged.
6. **Merge.** On a forge, use its merge command pinned to the verified head (on GitHub,
   `gh pr merge <N> --match-head-commit <sha>`). With no forge, `fleet land` (or
   `fleet land --squash -m <message>`): it checks the turn and the stamp, then moves the default
   branch to your head by compare-and-swap. No forge means the main checkout stays detached while
   the fleet runs; `fleet land` refuses otherwise. Then `fleet turn leave`.

**Hold the turn for at most one verification run plus one rerun of a flake.** Past that, leave and requeue. A
head whose owner is gone shows as `no live owner`: read that PR's remote state, then run
`fleet turn take-dead`. A head whose owner is **live but silent** is never taken: message that
session (SendMessage, naming the slot) and notify the user.

## Overrides of queue-run

- **§1, run parameters:** resolved once, by `/powerup-fleet start`, and recorded in the fleet's
  `run.json` (threshold, queue locator, merge authority, windows, exclusions, look-ahead window). A
  worker reads them from `fleet status`, never by asking again.
- **§2 step 2, picking the item:** take the first unfinished row in the queue's first `lookahead`
  unfinished rows (default 2N) that `fleet claim` accepts. Rank still decides. The window only lets
  a slot skip a row another slot's area blocks.
- **§2 step 4, the queue doc:** "in progress" lives in the claims, not the doc. Write the doc only to
  tick, park or file. Every write is read-apply-retry: read the current revision, apply your one
  change, and on a revision-mismatch rejection read again and reapply. Never overwrite another
  slot's change.
- **§1d, asking the user:** claim the question first (`fleet claim ask:<item>`), so one question
  reaches the user once. A question the user declines goes into the exclusions with
  `fleet exclude <item>`.
- **§3, usage:** the 5-hour window is no longer ignored. Pace on it with `fleet budget pace`.
- **§4, handoff:** the prompt starts with `/powerup-fleet`, and names the slot and the claimed item
  in flight. The run parameters are in `run.json`, so it does not need to repeat them.
- **§5, stopping:** a worker stops when the claim line refuses every eligible row, the queue is
  done, or the fleet is halted. **The last worker out writes the summary** (check `fleet status`:
  no other live owner holds a claim), covering the whole fleet. `fleet end` is the user's command;
  never run it.

## Composition rules

1. "In progress" lives in claims; queue-doc writes are read-apply-retry.
2. Claim a parked question (`ask:<item>`) before asking it; record a declined answer as an exclusion.
3. `fleet halt` on infrastructure or auth failure.
4. A mechanical update needs no new review or local suite.
5. **Git only in your own tree.** No `git stash`; never check out main (branch from `origin/main`);
   retry a fetch on a ref-lock error, because another slot is fetching. A shared side repository is
   used by explicit paths only, under `fleet with-lock <repo-name>`.
6. A queued CI run is not a stuck one; give `wait-pr-ci` a longer deadline. Where the queue, the
   claims and the turn need no forge, neither does the fleet: a local-only repository runs the same
   protocol, landing with `fleet land`.
7. Notifications name the slot; the last worker out writes the summary.
8. Names of per-item scratch state, such as design workspaces, carry the item id, so two slots never
   share one.

Memory and skill edits are parked for the user while a fleet runs: write the proposed edit into the
final report rather than into the files, since every slot reads them.

## The project config

Two checked-in files. `fleet init` reads `.claude/fleet.json`; when it is absent, init refuses and
prints a template (and the gate template, when that file is absent too). Its fields:
- the worktree root and the build-directory policy;
- `main_ref`, the ref slots branch from: `origin/main` with a forge, the local `main` without one;
- the heavy commands that need the suite lock, as regexes, each with its bound;
- the serial resources, each `pool` (with its values) or `counter` (with a command that prints the
  current maximum on `$REF`);
- the mechanical files and the command that regenerates each;
- the branch update method (always `merge`);
- the area vocabulary.

`.claude/gates.json` is the merge gate's config, read by `gate.sh` in every session, fleet or not.
Every field is optional, and GitHub with CI needs none of them:
- `forge` — `github`, `gitlab`, `other` or `none`. Default: `github` when origin is on github.com,
  `none` with no remote. Any other remote is unrecognized: its merges are logged, not gated, until
  configured.
- `merge_cmd`, `sha_flag`, `head_cmd`, `checks_cmd` — the forge's merge command (a regex), its
  head-pinning flag, and shell commands printing change `$PR`'s head sha and its checks as JSON
  `[{name, bucket}]`. Built in for GitHub only.
- `ci` — whether CI exists. Default: on for GitHub; elsewhere on when `checks_cmd` is set.
- `required_checks` — the names that must pass. Default: every listed check.
- `verify_cmd` — the complete local suite command. With no CI, its `verify-head` stamp on the
  merged head is the merge evidence.
- `default_branch` — default: origin's HEAD, else `main` or `master`.
