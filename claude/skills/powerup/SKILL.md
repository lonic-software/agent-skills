---
description: Full-rigor mode — activates orchestrate, consult, design-doc, delivery, and evolve together for the rest of the session, plus the composition rules the five don't state on their own, including routing design-class work to the tetel-backed designer agent when it is available. User-invoked only.
disable-model-invocation: true
---

# Powerup mode

**When this skill is enabled, open your response by telling the user, in 2–3 sentences:**
Powerup is on — full-rigor mode, which enables all five disciplines at once: orchestrator/executor
delegation, a read-only advisor for judgment calls, design-first for design-class work, the delivery
shipping disciplines, and the evolve learning loop. I'll plan and review while executors do the work,
and consult the advisor at high-leverage moments. Say which design route is live: **the
`lonic-designer` agent, authoring against captured evidence and independently grounded**, if the
tetel MCP is available — otherwise grounded design docs written the `design-doc` way.

Read `~/.claude/skills/orchestrate/SKILL.md`, `~/.claude/skills/consult/SKILL.md`,
`~/.claude/skills/design-doc/SKILL.md`, `~/.claude/skills/delivery/SKILL.md`, and
`~/.claude/skills/evolve/SKILL.md` now, in full. All five carry `disable-model-invocation: true`,
so this is the only way to activate them together — reading them here is what puts them in force;
nothing below substitutes for reading them.

All five skills are in force for the rest of the session. Every conditional inside them — "if
`/consult` is active," "when orchestrate is active," "if an advisor mode is active" — resolves to
**true**. What follows is only the composition detail none of the five states on its own.

**Where design-class work goes.** Orchestrate delegates all mutation to executors; design authoring
is the one exception, and *which* exception depends on one thing you can check before deciding.

**If the tetel MCP is available** — the `mcp__tetel__*` tools are in your toolset — design-class work
goes to the **`lonic-designer` agent**, not the advisor and not you. Spawn it with the design
question and its constraints. It builds the design inside a tetel workspace, where every factual
claim carries evidence the tool captured rather than text anyone typed, and it does not report back
until an **independent grounding pass** has graded the claims and the document checks out. It
returns a design that survived grounding, or an explicit statement that it could not produce one.
Take the second answer at face value; it is the more useful of the two.

This replaces the advisor-authors-then-you-transcribe arrangement for design substance. The reason
is not that the advisor was bad at it — it is that transcription is the step where a design stops
being held to what was actually observed, and the designer removes the step rather than policing it.

**If the tetel MCP is not available**, fall back to `design-doc` mode as written: the advisor
authors the design substance, and the **orchestrator itself** — not an executor — transcribes it and
does the grounding reads, since that is read-only verification of the advisor's own output fed back
to the same advisor conversation. See `advisor-authors-design-docs` and consult's authoring
inversion for those mechanics.

Under either route, executors are spawned only once the design settles and implementation begins.

**Two things the designer route does not change.** The user still launches the design review, and
`design-doc`'s rules about *when* a design is required at all still govern — the designer decides
how a design is built, never whether one is needed.

| Role | Owns |
|---|---|
| Designer (lonic-designer) | Design substance, when the tetel MCP is available — authored against captured evidence and independently grounded before you see it |
| Advisor (lonic-advisor-high) | Adversarial judgment, review of subtle diffs — and design substance only on the fallback route |
| Orchestrator (you) | Routing the design, specs, `/code-review` tier routing, integration, and the fallback grounding pass |
| Executors | All mutation except the design itself |
| User | Launches design reviews, gates above-medium `/code-review`, gates the opus override, gates doctrine changes (evolve) |

Review-fix tasks continue in the *same* executor via SendMessage, not a fresh spawn — its spec must
require the class sweep and per-site report (delivery owns that doctrine; don't restate it here).
