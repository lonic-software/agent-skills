---
description: Delivery mode — mode-independent doctrines for shipping work in any session: grounding handed-down findings, code-review routing and tiers, one-finding-one-PR shipping cadence, and fix-the-class execution discipline. User-invoked only.
disable-model-invocation: true
---

# Delivery mode

**When this skill is enabled, open your response by telling the user, in 1–2 sentences:**
Delivery is on — I'll ground handed-down findings — and my own checkable claims — before acting,
route pre-merge review through
`/code-review` (after CI is green where a PR with checks exists; medium default; above-medium only
with your approval), ship one finding per PR, and
fix the class with run-and-reported revert-checks.

Scope: this skill holds the doctrines that apply to shipping work regardless of which other mode
is active — orchestrated or not, with or without an advisor, with or without a design doc in
flight. It is not a junk drawer: a doctrine with a mode-specific home lives there instead of here
— design-first class criteria belong to design-doc, advisor authorship belongs to consult,
executor tiering and the foreground/timeout rule belong to orchestrate and the exec agent
definitions. This skill only owns what has no other home.

## A. Evidence rules

Treat every handed-down finding as unverified until you check it against current code — a Jira
ticket, a prior-session summary, an executor's report, a review finding, a memory file. All of
these describe a past state of the code or a past act of reading it; none of them are the code
itself. The memory system already enforces this discipline on its own output: it stamps memory
reads with a warning to verify against current code before asserting anything as fact. Apply that
same caution to every other secondhand claim, not just memories.

**Your own freshly authored claims get the same treatment.** A claim does not need to be handed
down to be unverified — the sentence you wrote two minutes ago about current code, a tool, or an
environment ("every call site goes through X," "the formatter keeps chains on one line," "no status
yet means the run finished") describes your model of the code, not the code. The trigger is
observable, not a feeling: you are about to **act on** a load-bearing factual claim — load-bearing
meaning the next step changes if it is false — that a single grep, file-open, or five-line run
could settle, and you have not run that check this session. Run it first; the check costs seconds,
and the argument it replaces costs a rebuild when it collapses. Argument length is the secondary
tell: when your justification for why something works keeps growing, some sentence in it is a
checkable fact doing work a file could do — open the file instead of extending the argument.
(Design-doc's "cite nothing you have not opened this session" is this same rule confined to doc
authoring; this paragraph is its session-wide form, for claims that never enter a doc.) For
enumeration claims specifically — "these are all the callers/writers/surfaces" — design-doc's
bound-not-members rule applies even when the claim never enters a doc: a set is only as verified
as the sweep or closing mechanism that bounds it, and individually verified members never upgrade
the set.

Verification sometimes shows the finding was wrong — a cited function no longer exists, a line
number has drifted, a described behavior doesn't reproduce. That outcome is a first-class
**success**, not a failed task: "not reproduced, here's the evidence, here's the narrower real gap"
is exactly what grounding is for. Record refuted findings as refuted — don't quietly drop them or
silently reinterpret them into something that does reproduce.

**Current means the latest base, not the one you happen to hold.** Before you ground a task, a
design doc, or an implementation, fetch the branch the work will merge into and ground against its
tip — fetching is enough; grounding needs the fresh tip, not a rebase of anyone's branch. Work
grounded on a stale base can be invalidated wholesale when the branch has moved: a cited line
drifted, the path was refactored, the very defect was already fixed. Where there is no remote to
sync from, local *is* latest and this is a no-op; where a fetch fails, say so and proceed on the
base you hold rather than blocking. And if the target branch moves while you work — a long design
especially — re-ground against the new tip before you finalize; a citation opened against a
superseded base is stale even though you opened it.

## B. Review routing and tiers

`/code-review` is the standard pre-merge gate. This skill is the only place its usage policy is
documented — routing decisions elsewhere should cite this section, not restate it.

- **Where a PR is viable, let CI go green before the review gate.** When the change ships as a PR — a
  remote forge is in play, not a local-only repo — and the project has checks that run on the PR,
  open the PR and let the automated checks pass *before* you run the `/code-review` merge gate. A red
  pipeline surfaces mechanical breakage (build, lint, failing tests) far more cheaply than a reviewer
  would; reviewing a diff CI would reject spends the expensive gate on findings the cheap one already
  owns. This **orders** the gates, it does not merge them — green CI is necessary, never sufficient,
  and never substitutes for the review. Skip the wait when there is no forge or no CI, and don't
  grind on a stuck or flaky pipeline: if CI can't go green for reasons unrelated to the diff, say so
  and proceed to review rather than blocking. Design-doc reviews are exempt — they are user-launched
  (see the design-doc bullet below) and gate the doc's content, which CI does not check.
- **Default to medium effort.** Drop to **low** only for changes that are genuinely simple and
  small — a rename, a localized fix, boilerplate.
- **Above-medium (high/ultra) is expensive and user-gated.** Never auto-trigger it. The routine,
  autonomous pre-merge gate is low or medium; above-medium is *offered*, never launched on your own
  authority.
- **The offer must be evidence-shaped**, mirroring the same discipline orchestrate applies to
  executor escalation: offer above-medium only when you can name a concrete reason medium won't
  suffice — the change sits in the contract/failure-path class, the diff is too large for one
  reviewer to hold at once, or a medium round already produced findings whose fixes touch a shared
  primitive (the escalating-rounds pattern; see §C). "This matters" is not a reason — gravity is
  not evidence. State the cost plainly and let the user decide.
- **Check the economics before offering.** Pressure for an expensive code review is often the
  symptom of a skipped design review, not a reason to spend more on code review. Before offering
  above-medium, ask whether this was design-doc-class work that skipped its doc — if so, the fix is
  a design doc, not a bigger review.
- **Design-doc reviews are `/code-review`, but user-launched — not part of the autonomous pre-merge
  gate.** A design doc flagged ready-for-review is reviewed by running `/code-review` on the doc;
  the design-doc skill's flag-and-stop rule owns *when* — the user launches it, you never
  auto-trigger it as part of the pre-merge gate. The user picks the tier at launch — the tier
  gating above governs only reviews launched on your own authority, and a user-launched review is
  user-approved at whatever tier the user names. If asked to recommend a tier, apply the same
  evidence-shaped reasoning as above.
- **Every review you suggest or hand off ships with its command — every time, including repeats.**
  This holds whether you raised the review or the user asked for it, and **whether or not you gave
  the same command in an earlier turn**. Never write "the command from before", "as above", or a
  bare "run a review round" — restate the full invocation. The user is usually several turns and a
  scroll-back away from the last one, the path or scope has often moved since, and friction here
  does not produce a question, it produces a review that is skipped or run against the wrong thing.
  Always use the **absolute** path: a repo-relative path is not enough, because design memos often
  live outside the working repo, and a review invoked there has no diff to anchor on — it falls back
  to the branch diff and silently reviews the wrong artifact, which reads as a completed review of
  the thing you asked about.
- **The command carries context, not just a path.** A bare path spends the reviewer's budget
  re-deriving what is already settled and re-finding what four earlier rounds confirmed. Do not
  assume the reviewer inherits your conversation: it may run in a separate context entirely, and
  even when it forks the session, that context may have been **compacted** down to a summary. State
  what matters rather than betting review quality on inheritance. Worth including, when each
  applies: which round this is and what prior rounds found; the base commit; the scope, naming what
  to skip **and why**; which parts are new or unreviewed since the last round; conventions that
  would otherwise read as defects (a corrections log describing deliberately superseded positions, a
  section declared the single source of truth); and known gaps you do not want re-reported.
- **Scoping narrows effort, never permission.** An instruction may tell a reviewer where to spend
  its budget; it must never tell it to stay silent about a defect it finds anyway. "Don't re-verify
  the citations" is legitimate; anything that would suppress reporting a real problem is not — that
  turns a scoped review into a review that looks clean because it was told to.
- **Say which bets your scoping makes.** Excluding a section is a judgement the user should get to
  overrule, so name what a skipped area could hide and what it would cost to include it. A scope
  the user cannot see is one they cannot correct.
- **Report tier choices like spawn costs.** State which tier you ran and why, the same way
  orchestrate reports every executor spawn's configuration — the user is tracking review spend the
  same way they track model spend.

## C. Shipping cadence

One finding, one PR: each review finding gets its own PR, reviewed and merged before the next one
starts — never a batch.

- Findings **on** the work in progress get fixed before merge, folded into the same PR. Genuinely
  separate, new-class findings get filed as tickets, lazily — only once independently confirmed,
  not pre-filed on suspicion — so the PR doesn't scope-creep and the finding doesn't get lost.
- **Entanglement check before parallelizing.** Two findings or tasks that touch the same primitive
  must run sequentially, never in parallel — splitting them without checking recreates the exact
  interaction the split was meant to prevent.
- **Diff-size conscience.** A diff too large for a reviewer to hold at once is what turns each fix
  into the next finding — this is how a batch of "closed" findings becomes three more rounds of
  live ones. When review rounds **escalate** instead of converging (each round finding something
  worse than the last), that is the signal to stop patching and discard the branch, rebuilding
  contract-first in slices instead.

## D. Fix execution

Fix the class, not the finding. A finding names one call site, but the defect usually lives in a
shared primitive with many callers — a fix verified only at the named site passes its own
regression test while the class stays broken.

- **Sweep every caller** of the primitive involved; fix each or explicitly exempt it.
- **Report per-site status**, including the sites that are *correct as written* — that's evidence
  the sweep happened, not padding.
- **Reuse existing helpers** before writing new comparison or guard logic — check for the helper
  that already solves it one file over.
- **Prefer moving the guarantee into the primitive** over special-casing every call site, so future
  callers can't get it wrong.
- **Revert-check, run and reported — both directions.** No durability or contract clause ships
  without a test demonstrated **green with the fix in place and red when the fix — and only the fix
  — is reverted**. Both runs must actually be **run** and their output reported; never asserted. A
  red-only report — a pinning test committed "red for the predicted reason" — establishes nothing by
  itself: red in both worlds pins as little as green in both. At code time both worlds exist, so
  neither direction may be left owed at merge. (This is the code-side twin of design-doc's
  falsifying-test rule, applied after the code exists instead of before it.)
- **A test that claims coverage names its enforcer.** A shipped check asserting "every X
  conforms" or "no X escapes" needs the mechanism that makes its checked domain equal its claimed
  domain — or a committed escape probe from outside its visible domain — or its name and docs
  narrowed to the cases it actually checks. Sampled mutations going red do not establish
  coverage. (This is the code-side twin of design-doc's coverage-claim rule.)
- **Changed contract, changed test.** If a contract's behavior changes, its test changes with it in
  the same PR.
- **Never sync docs to defective code.** "Code wins over docs" is dangerous exactly when the code
  is the bug — reconciling a doc to match buggy behavior documents the defect instead of fixing it.
