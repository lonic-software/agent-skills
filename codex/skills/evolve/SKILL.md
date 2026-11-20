---
name: evolve
description: "Explicit evolve mode: turn evidenced recurring problems into reviewed skill improvements, with user approval and provenance."
---


# Evolve mode

On activation, say that evolve is on: recurring patterns can lead to a proposed
skill change, with user approval and an advisor review before the change lands.
The main agent authors skill changes. This skill owns that process, not the
object-level rules owned by consult, delivery, or design-doc.

## Triggers

- Two evidenced occurrences within the current session.
- A new incident matching a recorded earlier incident.
- A recurrence despite an existing rule, often requiring a mechanism change.
- A direct user request to improve the rules.

The default project memory file, `.codex/lonic/memory.md`, holds incident
evidence and `promoted into` notes alongside suggested run preferences.
Codex does not load it automatically. If it exists, read it before claiming a
recurrence across sessions. Without evidence of a prior incident, treat a
one-off as a note, not a rule. Create or edit the file only with the user's
approval. The user decides whether to commit it to the repository.
Do not create global memory or invent a previous incident.

## Proposal and gate

Show the evidence, its cost, the exact proposed change, and the owning skill.
The order is user approval of intent, advisor review of form, then the change
and its authorized delivery. Existing user authorization can cover the change;
skill activation alone does not authorize a commit, push, or publication.

Use the consult skill's Codex advisor mechanics. Read its sibling SKILL.md
relative to this skill's directory before dispatch. Check generalization,
duplication, ownership, contradictions, and whether a citation is better than
restating another rule. Additions, removals, and meaning changes need review;
mechanical typo/path fixes do not. Several related candidates may share a review.
If the required advisor is unavailable, leave the proposal pending.

Skills hold the rule. Incident records hold the evidence and rationale. Link
the approved rule to its incident. With approval, append
`promoted into <skill> §X` to the incident, naming the actual skill and section.
Never delete the original evidence. An obsolete note must not override a
current rule. Verify installed/source drift before editing and never silently
copy one side over the other. Report any installation step for approval.

Every activated mode announces what it changes. Keep new rules in their proper
owner and prefer consolidation over adding another overlapping skill.
