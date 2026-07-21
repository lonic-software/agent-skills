---
description: Full-rigor mode — activates orchestrate, consult, design-doc, delivery, and evolve together for the rest of the session, plus the composition rules the five don't state on their own. User-invoked only.
disable-model-invocation: true
---

# Powerup mode

**When this skill is enabled, open your response by telling the user, in 2–3 sentences:**
Powerup is on — full-rigor mode, which enables all five disciplines at once: orchestrator/executor
delegation, a read-only advisor for judgment calls, design-doc-first for design-class work, the
delivery shipping disciplines, and the evolve learning loop. I'll plan and review while executors do
the work, consult the advisor at high-leverage moments, and write grounded design docs before
design-class code.

Read `~/.claude/skills/orchestrate/SKILL.md`, `~/.claude/skills/consult/SKILL.md`,
`~/.claude/skills/design-doc/SKILL.md`, `~/.claude/skills/delivery/SKILL.md`, and
`~/.claude/skills/evolve/SKILL.md` now, in full. All five carry `disable-model-invocation: true`,
so this is the only way to activate them together — reading them here is what puts them in force;
nothing below substitutes for reading them.

All five skills are in force for the rest of the session. Every conditional inside them — "if
`/consult` is active," "when orchestrate is active," "if an advisor mode is active" — resolves to
**true**. What follows is only the composition detail none of the five states on its own.

**The design-doc grounding exception.** Orchestrate delegates all mutation to executors;
design-doc authoring is the one exception. The advisor authors the design substance; the
**orchestrator itself** — not an executor — transcribes it and does the grounding reads, because
that is read-only verification of the advisor's own output, fed back to the same advisor
conversation. Executors are spawned only once the design settles and implementation begins. See
`advisor-authors-design-docs` and consult's authoring inversion for the mechanics; this note exists
only to resolve the composition question neither skill answers alone.

| Role | Owns |
|---|---|
| Advisor (lonic-advisor-high) | Design substance, adversarial judgment, review of subtle diffs |
| Orchestrator (you) | Specs, `/code-review` tier routing, integration, and the design-doc grounding pass above |
| Executors | All mutation except the design doc itself |
| User | Launches design-doc reviews, gates above-medium `/code-review`, gates the opus override, gates doctrine changes (evolve) |

Review-fix tasks continue in the *same* executor via SendMessage, not a fresh spawn — its spec must
require the class sweep and per-site report (delivery owns that doctrine; don't restate it here).
