---
description: Consult mode — for the rest of the session, consult the lonic-advisor-high agent (Fable 5 by default, read-only) at high-leverage judgment moments, and hand it design authorship for design-doc-class work; the main session stays on the cheaper model and does all the execution. User-invoked only.
disable-model-invocation: true
---

# Consult mode

**When this skill is enabled, open your response by telling the user, in 1–2 sentences:**
Consult is on — a read-only advisor (your preferred model, per `~/.claude/lonic/advisor.md`) is
available for design decisions, debugging strategy, and adversarial review; I'll consult it at
high-leverage moments and stay on the cheaper model for the work.

For the rest of this session, you have access to a more capable model as a consultant: the `lonic-advisor-high` agent (Fable 5 by default, read-only). You remain the executor — all edits, tests, and integration stay with you. The advisor exists to upgrade your *judgment* at the few moments where judgment is the bottleneck.

## When to consult

Consult the advisor when the cost of being wrong exceeds the cost of the consultation:

- **Design decisions with lasting consequences** — architecture, invariants, on-disk formats, public API shapes, concurrency protocols. If the work is the design-doc class, do not treat this as a judgement call about whether to ask a question — go to *Design work: the advisor authors, you transcribe* below, which governs. Choosing between candidate approaches **is** the design decision; it is not settled merely because you can defend your pick.
- **Gnarly debugging** — you've formed hypotheses but can't discriminate between them, or you've made two failed fix attempts on the same problem. Ask for debugging *strategy*, not just "find the bug".
- **Adversarial review of subtle diffs** — correctness-critical or concurrency-touching changes where reading the diff yourself isn't sufficient confidence.
- **Sanity-checking a plan before expensive execution** — a refactor or migration that would be costly to redo if the decomposition is wrong.

## Design work: the advisor authors, you transcribe

Point questions are the normal mode, but feature design is different. When the task is *designing* something — a new feature, invariant, on-disk format, or protocol, i.e. the class that warrants a design doc first (the design-doc skill owns the full criteria for that class) — invert the division of labor for the design phase:

- **The advisor authors the design substance.** Send it the goal, hard constraints, prior decisions that bound the space, and the relevant code paths. Ask for a complete design: the recommendation, the invariants it introduces, the alternatives it rejected and why, and — for anything durability- or concurrency-shaped — the falsifying test for each invariant.
- **You remain the scribe and verifier.** Transcribe the design into the doc, ground every claim in file:line references against the actual source, and flag discrepancies back to the same advisor via SendMessage rather than silently patching them. Execution and testing stay with you as usual.
- Keep the same advisor context through the whole design phase (SendMessage, not respawn) — drafting, your grounding pass, and revisions are one conversation.
- This inversion is for the design-doc class only. Small features you'd implement without a design doc stay in the normal mode: you design, and consult only if a specific decision meets the bar above.

Tier: default `lonic-advisor-high`; `lonic-advisor-xhigh` when the design space is correctness-critical and genuinely open. Never `lonic-advisor-medium` for design authorship — you cannot grade a design you couldn't produce.

## When NOT to consult

- Routine implementation, mechanical changes, anything you're confident about. Most of the session should involve zero consultations.
- Questions answerable by reading the code or docs yourself — do that first; the advisor will re-read the code anyway and a lazy question wastes its context. But note the limit of this exemption: verifying facts yourself discharges the *question*, never the *design authorship* above. "I traced it myself, so I can pick the approach" is the exact rationalisation that skips the inversion — grounding claims is the scribe's job, and doing it well does not promote you to author.
- As a rubber stamp. If you'd proceed identically regardless of the answer, don't ask.

## How to consult

- Spawn via the Agent tool with `subagent_type: "lonic-advisor-high"`. It runs in the background by default — keep working on independent things while it thinks, or pass `run_in_background: false` when the answer gates your next step.
- **Send a context package, not a vibe.** State: the decision or problem, the constraints, what you've already tried or considered, the specific files/lines involved, and the exact question. The advisor is read-only and will verify your framing against the source — give it the paths it needs.
- **Ask for a recommendation**, with reasoning and risks — not a menu of options.
- **Continue, don't respawn.** Use SendMessage for follow-ups on the same problem (the advisor keeps its context); spawn fresh for unrelated questions.
- The advisor cannot edit anything. Whatever it recommends, you implement and verify yourself — its word is advice, not evidence. Test results and diffs remain your responsibility.
- Tell the user when you consulted it and what it changed about your approach, in one sentence.

## Advisor model & effort preference

The advisor's **model** and **default effort** are not hardcoded — they are a user preference,
stored at **`~/.claude/lonic/advisor.md`** as simple human-editable fields:

```
model: fable
default-effort: high
```

- **If the file is absent**, ask the user for their preferred advisor model and default effort
  before the first consultation of the session, then create the file from the answer.
  Recommend **Fable** — it is the strongest advisor — but warn accurately: it is also the most
  expensive, and its availability is plan-limited. It may not be included on the Pro plan at all,
  and on Max 5x / Max 20x plans only 50% of the weekly allowance may be spent on Fable, beyond
  which it runs on usage credits only. Offer **Opus** as the strong alternative, especially when
  the orchestrator itself is running on Sonnet (e.g. an opus-medium orchestrator paired with an
  opus-xhigh advisor). There is no tool that can check plan entitlements or model availability —
  the user's answer is the source of truth, and a spawn failure is the signal to re-ask, not to
  guess.
- **If the file is present**, use it: spawn `lonic-advisor-<effort>` with a `model:` override set
  to the preferred model, and use the preferred `default-effort` as the tier baseline in place of
  the "default to high" language in *Cost discipline* below — the per-task medium/escalate-to-xhigh
  judgment in this skill still applies on top of that baseline, it just starts from the user's
  chosen default rather than a fixed one.
- **"Switch my advisor to X"** updates the file.
- **Report the advisor's actual model and effort on every consultation**, exactly like orchestrate
  reports executor spawn cost — e.g. `lonic-advisor-xhigh (opus, effort xhigh) — <reason>`. Never
  leave the model implicit now that it varies per user.

## Composing with /orchestrate

If `/orchestrate` is also active in this session, orchestrate's division of labor wins: executors do all execution, and the "you remain the executor" framing above does not apply. Your role is coordinator, and the advisor upgrades your coordination judgment — decomposition, design calls, and review of executor diffs. Everything else in this skill (when to consult, context packages, recommendation-not-survey, cost discipline) applies unchanged.

## Cost discipline

The advisor runs on your most capable model (per the preference file) and each consultation spawns a fresh, costly context. A handful of consultations per session is the expected shape — if you're consulting more than a few times an hour, either the task genuinely belongs on a stronger main model or you're offloading thinking you should do yourself. Three advisor tiers exist (effort is pinned per agent definition; model comes from the preference file — see *Advisor model & effort preference* above — and all tiers are read-only):

| Agent | Effort | Use for |
|---|---|---|
| `lonic-advisor-medium` | medium | **Verifiable questions only**: second opinions where you already have a candidate answer, plan sanity-checks ("what am I missing?"). You must be able to grade the response against your own analysis. |
| `lonic-advisor-high` | high | **The baseline tier** (unless the preference file's `default-effort` says otherwise) — design decisions, debugging strategy, adversarial review: anywhere your confidence falls materially short of the stakes. You could form an answer, but you wouldn't bet the decision on it without stronger review. |
| `lonic-advisor-xhigh` | xhigh | Rare: subtle concurrency, correctness-critical design-space searches — where you can articulate in advance why high won't suffice, or a high consultation came back inconclusive. |

The tier rule differs from executors, deliberately: executor output is caught by your review and the tests, but **advice has no safety net** — at the baseline tier you consult precisely because you can't fully grade the answer. So cheapest-that-can-succeed applies only when the response is verifiable (medium tier); for real unknowns, default to the preferred baseline and escalate on evidence. There is no cheaper model tier below the advisor — the cheaper "advisor" for ordinary judgment calls is your own reasoning. The medium advisor is instructed to say when a question exceeds its tier; take that escalation recommendation seriously.
