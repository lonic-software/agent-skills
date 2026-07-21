---
description: Evolve mode — owns the rules for turning a repeated pattern into a durable skill-set change: what triggers a proposal, the propose-then-gate pipeline, and how memory and skills stay in provenance sync. User-invoked only.
disable-model-invocation: true
---

# Evolve mode

**When this skill is enabled, open your response by telling the user, in 1–2 sentences:**
Evolve is on — when a pattern recurs (within a session or across them), I'll propose folding a
discipline into the skills, with your approval and an advisor-gate, rather than editing them
silently.

This skill owns the rules for changing the skill set itself — nothing else. A doctrine with an
object-level home (executor tiering, review routing, design-doc criteria, ...) lives there instead.
Skill self-edits are main-thread work: orchestrate already carves out "edits to this orchestration
config itself" as the orchestrator's own job, not an executor's — that carve-out is what makes
edits under this skill legal at all; it is not restated here.

## Trigger

Three arms plus a first-class fourth path — any one qualifies:

1. **IN-SESSION** — the same pattern hits twice within one session, both incidents in live context.
   The primary, most reliable arm: long sessions surface repeats directly.
2. **CROSS-SESSION** — a second incident lands in the class of an existing feedback memory. The
   `MEMORY.md` index is auto-loaded, so this is a context scan, not a search.
3. **RULE-FAILED-TO-BIND** — a recurrence *despite* an existing rule. Usually needs a WIRED fix — a
   gate, an agent-definition edit, the guarantee moved into the mechanism — not more prose (delivery
   §D's "move the guarantee into the primitive," applied to process).
4. **USER-INITIATED** — the user asks for the promotion directly; skip straight to the pipeline.

A one-off is not doctrine material — it goes to memory only.

## Propose, never self-edit → pipeline

Surface the pattern, its cost, a specific actionable candidate rule, and which skill should own it
— citing the prior memory or incident. User decides whether it ships: **user first** (gates intent,
cheap) → **advisor-gate second** (gates form, expensive; default `lonic-advisor-high`) → **commit
third**.

**Advisor-gate checklist:** generalization, already-exists-elsewhere, correct owner, contradiction
against the rest of the skill set, restatement-vs-citation. Additions, removals, and
meaning-changing corrections all gate — removals more dangerously than additions. Exempt: mechanical
edits (typos, path fixes, forced cross-ref updates). Batch several candidates into one consultation.

## Provenance: statute vs. case law

Skills hold the rule in force; memories hold the incidents, evidence, and why. Promotion links the
two and never deletes the memory — its `MEMORY.md` index line gets a "promoted into `<skill>` §X"
marker, the convention the index already uses (e.g. "SHIPPED as PR #68"). Skill wins on conflict —
what lets an obsolete rule be removed safely later instead of becoming undeletable dogma.

## Authoring standard

Every skill opens with an on-enable announcement the agent relays when the skill is activated (this
rule is owned here; each announcement's wording is owned by its own skill).

## Restraint

The evidence requirement — a cited prior incident — is the guard: no "I noticed a pattern"
proposals from vibes, no numeric quotas bolted on top. A 7th skill proposed within weeks is a
signal to consolidate the existing ones, not to keep adding.
