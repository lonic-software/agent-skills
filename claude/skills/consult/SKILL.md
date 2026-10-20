---
description: Consult mode — for the rest of the session, consult a read-only advisor (`lonic-advisor-medium` by default, low for narrow checkable questions, high/xhigh only by escalation; model per the user's preference file) at high-leverage judgment moments, and have it attack the design-doc-class work the main session authors; the main session stays on the cheaper model and does all the execution. User-invoked only.
disable-model-invocation: true
---

# Consult mode

**When this skill is enabled, open your response by telling the user, in 1–2 sentences:**
Consult is on — a read-only advisor (your preferred model, per `~/.claude/lonic/advisor.md`) is
available for design decisions, debugging strategy, and adversarial review; I'll consult it at
high-leverage moments and stay on the cheaper model for the work.

For the rest of this session, you have access to a more capable model as a consultant: a read-only `lonic-advisor-<tier>` agent whose model comes from `~/.claude/lonic/advisor.md`. Start at `lonic-advisor-medium`; the tier table under *Cost discipline* says when to drop to low or escalate. You remain the executor — all edits, tests, and integration stay with you. The advisor exists to upgrade your *judgment* at the few moments where judgment is the bottleneck.

## When to consult

Consult the advisor when the cost of being wrong exceeds the cost of the consultation:

- **Design decisions with lasting consequences** — architecture, invariants, on-disk formats, public API shapes, concurrency protocols. If the work is the design-doc class, do not treat this as a judgement call about whether to ask a question — go to *Design work: you author, the advisor attacks* below, which governs. Choosing between candidate approaches **is** the design decision; it is not settled merely because you can defend your pick.
- **Gnarly debugging** — you've formed hypotheses but can't discriminate between them, or you've made two failed fix attempts on the same problem. Ask for debugging *strategy*, not just "find the bug".
- **Adversarial review of subtle diffs** — correctness-critical or concurrency-touching changes where reading the diff yourself isn't sufficient confidence.
- **Sanity-checking a plan before expensive execution** — a refactor or migration that would be costly to redo if the decomposition is wrong.

## Design work: you author, the advisor attacks

You author the design. The advisor's job is to attack it, not to write it — a read-only advisor
asserting mechanism produces exactly the un-executed prose design-doc's cheapest-falsifier rule
exists to stop, and transcription is where a design stops being held to what was observed.

- **Send it the design and ask what breaks**, not what to build. Point it at the load-bearing claims
  and at the joints *between* decisions — a design usually fails where two individually-defensible
  choices meet, not inside either one.
- **Ask which of its attacks failed.** A decision that survives an attack aimed squarely at it is the
  most useful thing a consultation returns, and it is the half that gets dropped if you don't ask.
- **One advisor per problem, resumed** (`SendMessage`, never respawn) through drafting, revision and
  re-attack. Spawn a fresh one for an unrelated problem: within a problem its memory is an asset;
  across problems it anchors on positions it already took.

Tier: **start at `medium`** and escalate only when medium says it cannot answer at its depth. `high`
when the space is genuinely open and you could not grade the reply yourself; `xhigh` only when it is
also correctness-critical.

## When NOT to consult

- Routine implementation, mechanical changes, anything you're confident about. Most of the session should involve zero consultations.
- Questions answerable by reading the code or docs yourself — do that first; the advisor will re-read the code anyway and a lazy question wastes its context. But note the limit of this exemption: verifying facts yourself discharges the *question*, never the *adversarial read* above. "I traced it myself, so the design holds" is the exact rationalisation that skips the attack — grounding a claim settles that it is true, not that the decision built on it is earned.
- As a rubber stamp. If you'd proceed identically regardless of the answer, don't ask.

## How to consult

- Spawn via the Agent tool with `subagent_type: "lonic-advisor-medium"` (`powerup:lonic-advisor-medium` when these skills are installed as the `powerup` plugin; use the form your session lists, for every tier) unless the tier table under *Cost discipline* points elsewhere — `low` for a narrow question with a checkable answer, `high`/`xhigh` only when a lower tier said the question exceeds its depth. It runs in the background by default — keep working on independent things while it thinks, or pass `run_in_background: false` when the answer gates your next step.
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
default-effort: medium
```

- **If the file is absent**, ask the user for their preferred advisor model and default effort
  before the first consultation of the session, then create the file from the answer. Recommend
  `default-effort: medium` — see the tier table below for why medium is the starting point.
  Recommend **Fable** — it is the strongest advisor — but warn accurately: it is also the most
  expensive, and its availability is plan-limited. It may not be included on the Pro plan at all,
  and on Max 5x / Max 20x plans only 50% of the weekly allowance may be spent on Fable, beyond
  which it runs on usage credits only. Offer **Opus** as the strong alternative, especially when
  the main session itself is running on Sonnet (e.g. an opus-medium session paired with an
  opus-xhigh advisor). There is no tool that can check plan entitlements or model availability —
  the user's answer is the source of truth, and a spawn failure is the signal to re-ask, not to
  guess.
- **If the file is present**, use it: spawn `lonic-advisor-<effort>` with a `model:` override set
  to the preferred model, and use the preferred `default-effort` as the tier baseline — the tier table under *Cost discipline*
  still decides when to drop below it or escalate above it.
- **"Switch my advisor to X"** updates the file.
- **Report the advisor's actual model and effort on every consultation** — e.g. `lonic-advisor-xhigh (opus, effort xhigh) — <reason>`. Never
  leave the model implicit now that it varies per user.

## Cost discipline

The advisor runs on your most capable model (per the preference file). A **fresh** consultation pays a cache write at 1.25x base input to establish its context. A **resume** re-sends that context at 0.1x (0.025x on Fable) while its cache is alive, which for every advisor tier is the 5-minute subagent default: advisors are mostly one-off, and a 1-hour cache would double their write cost for nothing (anthropics/claude-code#74318). Past that, the resume rebuilds the context at write price. Advisors are small, so resume within a problem anyway: their grasp of the problem is the point. Spawn deliberately. A handful of *distinct* consultations per session is the expected shape — if you're consulting more than a few times an hour, either the task genuinely belongs on a stronger main model or you're offloading thinking you should do yourself. Four advisor tiers exist (effort is pinned per agent definition; model comes from the preference file — see *Advisor model & effort preference* above — and all tiers are read-only):

| Agent | Effort | Use for |
|---|---|---|
| `lonic-advisor-low` | low | **Narrow, well-posed questions with a checkable answer** — what one function returns on the empty case, whether an API throws or returns null, a sanity-check on a short plan. Use freely; the docs name subagents as low's typical case. |
| `lonic-advisor-medium` | medium | **The baseline tier.** Start here. Second opinions, plan sanity-checks, adversarial reads where you hold a candidate answer and can grade the reply. Escalate only when it reports the question exceeds its depth. |
| `lonic-advisor-high` | high | When the space is genuinely open and you **could not grade the answer yourself** — design decisions, debugging strategy where your hypotheses have run out. Reached by escalation from medium, not as a starting point. |
| `lonic-advisor-xhigh` | xhigh | Rare: subtle concurrency, correctness-critical design-space searches — where you can articulate in advance why high won't suffice, or a high consultation came back inconclusive. |

The tier rule is strict here for one reason: **advice has no safety net.** Code you write is caught by review and by the tests; advice is not. So drop below the baseline only when you can check the answer yourself (`low`), start at the baseline (`medium`) otherwise, and escalate on evidence — a lower tier reporting that the question exceeds its depth — never on a hunch. There is no cheaper model tier below the advisor — the cheaper "advisor" for ordinary judgment calls is your own reasoning. The medium advisor is instructed to say when a question exceeds its tier; take that escalation recommendation seriously.
