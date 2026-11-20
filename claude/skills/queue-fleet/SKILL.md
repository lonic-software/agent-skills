---
description: Queue fleet — queue-run with N concurrent workers in one repository, each in its own worktree slot, coordinated by the `fleet` script (claims, locks, a FIFO merge turn, a shared budget). `/queue-fleet start N <queue-run args>` sets the fleet up and starts one background worker session per slot; `/queue-fleet` is what each of those sessions runs. Also the protocol /powerup-fleet runs on. User-invoked only.
disable-model-invocation: true
---

# Queue fleet

Several sessions work one project's queue at the same time, each in its own worktree (a **slot**).
This skill is the protocol between them. It is queue-run with overrides: read
`${CLAUDE_SKILL_DIR}/../queue-run/SKILL.md` in full and follow it, except where a section below
replaces a part of it by name. Run on its own, it is the fleet form of `/queue-run`; under
`/powerup-fleet` it is the fleet form of `/powerup-auto`, and that wrapper says how.

## Two forms

The **fleet's command** is the slash command its workers run: `queue-fleet` when this skill was
invoked directly, or the wrapper that read it (`powerup-fleet`). `fleet init --command` records it,
and `fleet status` prints it.

- **`/<command> start N <queue-run args>`: setting up, run once by the user from the main
  checkout.** This session works no item.
  1. Resolve queue-run §1 once, with the user: threshold, queue, merge authority, windows. Use
     N = 2 unless the user names another count.
  2. Run `${CLAUDE_SKILL_DIR}/fleet init --workers N --threshold … --queue … --merge-authority …
     [--windows …] --command <command>`. If it refuses for a missing project config, show the
     user the template it printed, propose a filled-in config from the repository, and stop until
     they accept it and it is committed.
  3. Init creates the slot worktrees, detached at the main ref, under the config's in-repo worktree
     root.
  4. Run `${CLAUDE_SKILL_DIR}/fleet launch`. It starts one background session per slot
     (`claude --bg`, named `fleet-<slot>`, in the slot, running `/<command>`) and registers each as
     its slot's owner before it starts, so a second launch never puts two workers in one slot. Relay
     its lines to the user: `claude agents` lists the workers, `claude attach <id>` opens one, and
     `fleet status` marks a worker waiting on them. Then stop. `fleet launch` again restarts the
     worker of any slot whose session has ended; a slot can also be worked by hand, with
     `cd <slot> && claude` and then `/<command>`.
- **`/<command>` (no args), or a handoff prompt that starts with it: a worker, in a slot**, usually
  a background session `fleet launch` started. When invoked directly, record the run for
  compaction recovery: `${CLAUDE_SKILL_DIR}/../powerup/powerup-mark set queue-fleet` (where powerup
  is installed; skip it otherwise). Open with one line naming the slot, then run `fleet whoami` before anything else,
  then the item loop. If `fleet status` names a different command than the one this session was
  started with, stop and tell the user: the fleet was set up for the other workflow.

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
turn. The turn is for **your claimed item's change only**: a change for anything else, such as
another slot's PR, one the user opened, or a side fix, is filed or left for the user, never merged
by you (queue-run's *Decision authority*). Inside it:

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
   <deadline>` (forge commands from `.claude/gates.json`). A queued run is not a stuck one: pass
   a deadline long enough for the fleet's CI load. With no CI: run the complete local suites on that
   exact head under the suite lock — `fleet with-lock suite -- delivery/verify-head -- <suites>` —
   which stamps it. Then confirm the default branch's tip is still the one you merged.
   `fleet collisions` checks it, and the version lines: it refuses when your HEAD lacks the main
   ref's tip, when the main ref is behind its remote, or when a merge of main kept a version line
   (the config's `version_lines`) that both sides added. Two branches bumping a counter to the same
   value merge without a conflict; take the next value, or ask the user when both sides really
   carry one change. The gate runs it before every merge in a fleet.
6. **Merge.** On a forge, use its merge command pinned to the verified head, from the slot whose
   HEAD is that head (on GitHub, `gh pr merge <N> --match-head-commit <sha>`). A change touching a
   protected path is the user's to merge: the gate refuses it, so leave the turn and tell them. With
   no forge, `fleet land` (or
   `fleet land --squash -m <message>`): it checks the turn and the stamp, then moves the default
   branch to your head by compare-and-swap. No forge means the main checkout stays detached while
   the fleet runs; `fleet land` refuses otherwise. Then `fleet turn leave`.

**Hold the turn for at most one verification run plus one rerun of a flake.** Past that, leave and requeue. A
head whose owner is gone shows as `no live owner`: read that PR's remote state, then run
`fleet turn take-dead`. A head whose owner is **live but silent** is never taken: message that
session (SendMessage, naming the slot) and notify the user.

## Overrides of queue-run

- **§1, run parameters:** resolved once, by the fleet's `start` form, and recorded in the fleet's
  `run.json` (threshold, queue locator, merge authority, windows, exclusions). A worker reads them
  from `fleet status`, never by asking again.
- **§2 step 2, picking the item:** walk the unfinished rows in rank order and take the first one
  that is not blocked on the user and that `fleet claim` accepts. A row refused because another slot
  holds it or its area is skipped for now, not for good: at every item boundary, walk again from
  rank 1. Rank decides; another slot's claim or area is the only reason to pass over a free row.
  If every eligible row is refused for a claim or an area alone, nothing is workable in parallel:
  wait until `fleet status` shows a claim released (re-read it no more than once a minute, bounded,
  in the background), then walk again. Intent: an idle slot is throughput lost, never a saving;
  the claim line is what bounds spend, not the depth of the pick. (A fixed look-ahead window was
  tried and removed: it never changed which row was picked, only made a slot idle when a row it
  could have claimed sat just past the window.)
- **§2 step 5, the queue doc:** "in progress" lives in the claims, not the doc. Write the doc only to
  tick, park or file. Every write is read-apply-retry: read the current revision, apply your one
  change, and on a revision-mismatch rejection read again and reapply. Never overwrite another
  slot's change.
- **§1d, asking the user:** claim the question first (`fleet claim ask:<item>`), so one question
  reaches the user once. A question the user declines goes into the exclusions with
  `fleet exclude <item>`. **Leave the merge turn before asking** (`fleet turn leave --requeue`): a
  session waiting on the user is still a live owner, so a held turn would stop every slot's merge
  until they answer. A background worker's question is seen only in `fleet status`, `claude agents`
  or its attached session, so notify the user (naming the slot) whenever you ask. Outside a
  window there is no asking (the hook denies AskUserQuestion): park, and notify once, as §1d says.
  The windows are `run.json`'s, in the form `powerup-mark` reads. When the user tells any worker
  when they are available, that worker records it at once with `fleet window set "<rules>"` (or
  `fleet window clear`); it holds for every slot, since it is the same user.
- **§3, usage:** the 5-hour window is no longer ignored. Pace on it with `fleet budget pace`.
- **§4, handoff:** the prompt starts with the fleet's command (`fleet status` prints it), and names
  the slot and the claimed item in flight. The run parameters are in `run.json`, so it does not need to repeat them.
- **§5, stopping:** a worker stops when the claim line refuses every eligible row, the queue is
  done, or the fleet is halted. A refusal for another slot's claim or area is not a stop: wait for
  a release, as in §2 step 2. **The last worker out writes the summary** (check `fleet status`:
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
- `main_ref`, the ref slots branch from: `origin/main` with a forge, the local `main` without one.
  It names the ref the gate reads its config from (the default branch, origin's copy when there
  is one): `fleet init` refuses another;
- the heavy commands that need the suite lock, as regexes, each with its bound;
- the serial resources, each `pool` (with its values) or `counter` (with a command that prints the
  current maximum on `$REF`);
- the mechanical files and the command that regenerates each;
- `version_lines` (optional): `{pattern, paths}`, an extended regex matching a hand-numbered
  version line, such as a format constant, and the globs it lives in; `fleet collisions` reads it;
- the branch update method (always `merge`);
- the area vocabulary.

`fleet init` copies it into the fleet's state, so an edit reaches a running fleet only after
`fleet end` and a new `fleet init`.

`.claude/gates.json` is the merge gate's config, read by `gate.sh` in every session, fleet or not.
The gate, `wait-pr-ci` and `fleet` read the default branch's committed copy (origin's, else the local
branch; `fleet` reads its `main_ref`'s), never the work tree's: a change, or an uncommitted edit, cannot loosen the rules that judge it, and an edit is in
force once it is on the default branch. While the committed copy does not parse, the gate denies a merge
until the user fixes it (`gh`/`glab`, any `pr merge`/`mr merge`, the `merge_cmd` still legible in
the broken text, and a local merge into the default branch where local merges are gated); commits and pushes still run on the defaults. Every field is optional, and GitHub with CI needs none of them:
- `forge` — `github`, `gitlab`, `other` or `none`. Default: `github` when origin is on github.com,
  `none` with no remote. Any other remote is unrecognized: its merges are logged, not gated, until
  configured.
- `merge_cmd`, `sha_flag`, `head_cmd`, `checks_cmd` — the forge's merge command (a regex), its
  head-pinning flag, and shell commands printing change `$PR`'s head sha and its checks as JSON
  `[{name, bucket}]`. Built in for GitHub only.
- `ci` — whether CI exists. Default: on for GitHub; elsewhere on when `checks_cmd` is set.
- `required_checks` — names that must be listed and pass, **on top of** every listed check passing
  or skipping. A forge lists only the checks that have registered, so name the ones a merge needs;
  on GitHub, require the same ones on the forge (a ruleset), or its web UI can merge while CI is
  pending. `fleet init` warns when GitHub with CI names none.
- `files_cmd` — shell printing change `$PR`'s changed paths, both sides of a rename; exit 3 means more
  files than the forge lists, which denies the merge. Built in for GitHub and GitLab.
- `protected_paths` — globs no session merges: the user merges those changes.
  `.claude/gates.json` and `.claude/fleet.json` are always protected, renames included.
- `commit_email` — the author email every commit and push must carry. The gate refuses a commit
  set up otherwise (in git's order: `--author`, `GIT_AUTHOR_EMAIL`, `user.email`, in the repository
  `git -C` names) and a push carrying another author or naming commits it cannot list (in a
  repository the command names readably; a `git -C` given by an expansion is refused only where the
  working directory sets `commit_email`), and `fleet init` refuses a repository whose
  configured email differs.
- `verify_cmd` — the complete local suite command. With no CI, its `verify-head` stamp on the
  merged head is the merge evidence.
- `default_branch` — the branch a local merge is judged against. Default: origin's HEAD, else
  `main` or `master`; the config itself is always read from that default, never from this field.
