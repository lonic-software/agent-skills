---
description: Queue run — work through a project's queue unattended, one item per session, handing off to a fresh session at each item boundary and stopping once weekly usage reaches a threshold the user sets for this run. Works on any repo. Args may carry the stop threshold, the queue location and merge authority, e.g. `/queue-run stop at 60%`. User-invoked only.
disable-model-invocation: true
---

# Queue run

Work the project's queue one item at a time. Each session finishes **one** item, then hands the next
one to a fresh session, until the weekly-usage threshold is reached or the queue runs out.

This skill only owns the *chain*: finding the queue, the stop rule, and the handoff. How an item is
actually done (design first or not, review tier, PR cadence, commit style) comes from the project's
own CLAUDE.md, memory and any other active skills. Follow those inside each item.

## 1. Resolve the run parameters (first session only)

A session started by a handoff gets all three parameters in its prompt. In that case, do not ask
again; go straight to §2.

Otherwise, resolve them from the user's prompt, and ask only for what is missing. Put every missing
question into **one** AskUserQuestion call.

**a. Stop threshold — always required, never assumed.** This is the weekly usage level, as a
percentage of the weekly limit, at which the chain stops. The user's level changes from day to day,
so do not reuse a value from memory, an earlier run, or a default. If the prompt doesn't state one,
ask, and include the current weekly usage in the question (read it with the `context` tool, see §3).
- An absolute value like "stop at 60%" is used as given.
- A relative value like "spend 10%" or "+10%" is converted once, now, to an absolute value: current
  usage plus N. From then on, only the absolute value is carried forward.
- If current usage is already at or above the threshold, say so and stop. Do not start an item.

**b. The queue.** Look, in this order:
1. The user's prompt.
2. Memory and CLAUDE.md, for a named queue, roadmap or backlog (a doc URL, a file, a board, a label).
3. The repo: files such as `QUEUE*`, `ROADMAP*`, `TODO*`, `BACKLOG*`, or `docs/` equivalents with an
   ordered, tickable list.
4. The tracker the project uses (GitHub issues/milestones/project board, Jira, etc.), if memory or
   CLAUDE.md points at one.

Use the queue without asking only when exactly **one** clear candidate exists and it has an
unambiguous order. If there is none, or several plausible ones, or one with no clear "next", ask the
user and offer the candidates you found. Record the answer as a precise locator (URL, path plus
section, or query) that a fresh session can open without searching.

**c. Merge authority.** Use the prompt or memory if either states it. Otherwise, ask in the same
question round. Recommended option: "merge once review has converged and every CI check on the
current head is green". Alternatives: "open PRs, never merge" (then the chain moves on to items that
don't depend on the unmerged PR, and lists the open PRs at the end), or "ask each time" (this ends the
chain at each merge point, so warn that it is effectively not unattended).

Confirm the resolved parameters back to the user in one or two lines, then start.

## 2. Each session: one item

1. **Check usage first** (§3). If it is at or over the threshold, stop (§5).
2. **Read the queue** freshly. The user may have reordered it since the last session, and their order
   wins. Take the **first unfinished item**. Skip items the queue or memory marks as parked or
   "ask first". Note them for the final report rather than asking mid-chain.
3. **Do the item** under the project's own workflow, to its natural end: merged (if authorized), or a
   PR left open with review done (if not).
4. **Update the queue**: tick the item, or mark it in progress or blocked with a one-line reason. File
   any follow-up work you discovered into the queue, so it isn't lost in a handoff.
5. **Check usage again** (§3). Under the threshold: hand off (§4). At or over: stop (§5).

**Items too large for a session.** If an item clearly spans several phases (design, then slices), a
*phase boundary* counts as an item boundary. Finish the phase, leave everything durable (committed,
pushed, written down), and hand off "continue item X at phase Y".

**Crossing the threshold mid-item.** Do not start new expensive steps such as another review round,
an agent fan-out, or a new slice. Bring the work to a resumable state: committed, pushed (as a draft
PR if needed), with the queue entry saying exactly where it stands. Then stop (§5). Never leave
uncommitted work behind.

**Before any fan-out** (multi-agent review, workflows), estimate its cost as a percentage of weekly
usage. If that estimate would cross the threshold, use the cheaper form or defer the step.

## 3. Reading usage

Call `mcp__phase-handoff__context`. It reports rate limits, including the weekly one, with current
usage and pace. Compare the **weekly** figure against the threshold. Ignore the 5-hour window for the
stop rule, but if it is exhausted, say so and stop rather than stalling.

If the tool is unavailable or reports no weekly figure, you cannot enforce the threshold. Say so, and
stop after the current item instead of chaining blind.

## 4. Handoff

Call `mcp__phase-handoff__handoff` as the **last action** of the session, then end the turn. The
prompt must stand alone, because it is all the next session knows. Start it with the same command that
started this run (`/queue-run`, or a wrapper such as `/powerup-auto`) so the same skills load again,
and include:

- **Stop threshold:** the absolute weekly percentage, e.g. `stop at 62% weekly`.
- **Queue:** the exact locator from §1b.
- **Merge authority:** the exact rule from §1c.
- **Standing exclusions:** anything the user said to always ask about, or to never touch, in this run.
- **Where things stand:** what just finished (PR numbers, merge commits), and anything in flight. If
  the next item is a continuation, include its phase and any hard-won context it needs. Otherwise, let
  the next session read the queue itself; don't pre-pick an item the user might reorder.

Before calling it, make sure everything the next session needs is on disk or in the queue: commits
pushed, the queue updated, notes written. A handoff prompt is not a substitute for durable state.

If the handoff tool is unavailable, stop (§5) and print the ready-to-paste prompt instead.

## 5. Stopping

Stop when any of these holds: the threshold is reached, the queue has no unblocked items left, an item
needs a decision only the user can make, or something is broken in a way the chain shouldn't guess
past (CI infrastructure down, auth expired, repeated review non-convergence).

The final report covers:
- **Done this run:** items with PR or merge links.
- **Left in flight:** state and exact resume point.
- **Skipped or needs you:** parked or "ask first" items, blocked items with reasons, and any open PRs
  awaiting merge.
- **Usage:** weekly usage at start and at stop.
- **Resume line:** a ready-to-paste `/queue-run …` prompt, with the threshold left as a blank for the
  user to fill in, since it will differ next time.

## Always ask, even mid-chain

Merging is the only outward action this skill authorizes, and only per §1c. Still stop and ask before:
releases or publishing, deploys, anything touching live infrastructure, destructive git (force-push,
history rewrites, deleting branches you didn't create), and anything the project's instructions mark
as needing the user. Asking ends the chain, so first leave state resumable (§2).
