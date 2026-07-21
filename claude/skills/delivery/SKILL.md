---
description: Delivery mode — mode-independent doctrines for shipping work in any session: grounding handed-down findings, code-review routing and tiers, one-finding-one-PR shipping cadence, and fix-the-class execution discipline. User-invoked only.
disable-model-invocation: true
---

# Delivery mode

**When this skill is enabled, open your response by telling the user, in 1–2 sentences:**
Delivery is on — I'll ground handed-down findings before acting, route pre-merge review through
`/code-review` (medium default; above-medium only with your approval), ship one finding per PR, and
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

Verification sometimes shows the finding was wrong — a cited function no longer exists, a line
number has drifted, a described behavior doesn't reproduce. That outcome is a first-class
**success**, not a failed task: "not reproduced, here's the evidence, here's the narrower real gap"
is exactly what grounding is for. Record refuted findings as refuted — don't quietly drop them or
silently reinterpret them into something that does reproduce.

## B. Review routing and tiers

`/code-review` is the standard pre-merge gate. This skill is the only place its usage policy is
documented — routing decisions elsewhere should cite this section, not restate it.

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
- **Design docs are excluded from this routing entirely.** Flagging a design doc ready-for-review
  and stopping for the user to launch the review is the design-doc skill's rule, not a tier of
  `/code-review` — never run `/code-review` on a design doc.
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
- **Revert-check, run and reported.** No durability or contract clause ships without a test that
  goes red when the fix — and only the fix — is reverted. The revert must actually be **run**, and
  its output reported; never asserted. (This is the code-side twin of design-doc's
  falsifying-test rule, applied after the code exists instead of before it.)
- **Changed contract, changed test.** If a contract's behavior changes, its test changes with it in
  the same PR.
- **Never sync docs to defective code.** "Code wins over docs" is dangerous exactly when the code
  is the bug — reconciling a doc to match buggy behavior documents the defect instead of fixing it.
