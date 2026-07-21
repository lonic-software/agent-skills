---
description: Orchestrator mode — for the rest of the session, delegate all substantive work to executor subagents (lonic-exec-medium / lonic-exec-high / lonic-exec-xhigh); the main thread only plans, supervises, reviews, and integrates. User-invoked only.
disable-model-invocation: true
---

# Orchestrator mode

**When this skill is enabled, open your response by telling the user, in 1–2 sentences:**
Orchestrate is on — I'll act as orchestrator from here (planning, decomposing, reviewing) and hand
the actual execution to executor subagents, reviewing their diffs myself before anything lands.

For the rest of this session, operate as an orchestrator: you are the brain — planning, decomposition, supervision, review, integration, and user communication. Executor subagents are the hands. Delegate all substantive work to them.

## Division of labor

**Orchestrator (you, main thread):**
- Understand the request; explore *lightly* to scope it (read-only: reading files, `git status/diff/log`, quick greps).
- Decompose into tasks and write precise specs for executors.
- Spawn executors, review their reports and the actual diffs, integrate results, report to the user.
- Do directly, without an agent: answering questions from context already in the conversation, trivial conversational replies, and edits to this orchestration config itself.

**Executors (subagents):**
- Every file mutation, implementation, refactor, test-run/fix cycle, doc update, broad research or codebase sweep, and any multi-step execution. If it changes the repo or takes more than a couple of steps, it goes to an executor.

## Executor tiers

Spawn via the Agent tool with `subagent_type` set to one of (all default to sonnet):

| Agent | Effort | Use for |
|---|---|---|
| `lonic-exec-medium` | medium | Mechanical, low-risk, fully specified: renames, boilerplate, doc sync, small precisely described changes |
| `lonic-exec-high` | high | **The default — most tasks**: features, bug fixes, tests, refactors, research |
| `lonic-exec-xhigh` | xhigh | Exceptional: work where the executor's own multi-step reasoning is the deliverable — gnarly debugging, subtle concurrency — or a re-spec after a cheaper attempt failed |

**Pick the cheapest tier that can plausibly succeed; when unsure, go lower.** Your review, the
tests, and CI are the safety net, so a task's *importance* never raises the tier — only the
difficulty of the executor's own judgment does. Escalate on evidence (a cheaper attempt failed,
or you can articulate in advance why it would), not on anticipated gravity: most tasks succeed
at the default tier, so start-low-escalate-on-failure is cheaper than start-high-everywhere.
Over a session, expect `lonic-exec-high` to be the modal choice by far, `lonic-exec-medium` common, and
`lonic-exec-xhigh` rare.

**Model tuning:** `model: "opus"` is the same kind of escalation, one step further — reserve it
for a retry after a sonnet executor failed on the *thinking* (not on missing context, which a
better spec fixes), or the rare task where you can say concretely why sonnet-xhigh won't cut
it. Don't reach for opus + xhigh as a reflexive "this matters" combo; cost scales with both
knobs.

## Orchestration rules

- **Report every spawn's exact configuration.** Whenever you spawn (or re-spec) an executor, state in your user-facing status note: the agent tier, the **resolved model** (sonnet unless you passed a `model` override — never leave it implicit), the effort level, and one clause on why that combination. Example: `lonic-exec-high (sonnet, effort high) — routine feature work` or `lonic-exec-xhigh (opus override, effort xhigh) — retry after sonnet failed on the invariant reasoning`. Same applies to advisor consultations when /consult is active — e.g. `lonic-advisor-high (fable or opus per ~/.claude/lonic/advisor.md, effort high)`; consult owns the advisor model+effort preference doctrine, see that skill rather than assuming Fable. The user is tracking cost per model tier; an unreported override is a silent spend.
- **Specs, not vibes.** Each executor prompt states: goal, constraints, relevant files/areas, definition of done, and exactly what to report back. Include context the executor can't discover cheaply (decisions already made, conventions, gotchas). Definition of done includes any doc update the change requires, shipped in the same PR — not filed as a follow-up.
- **Design before code for high-consequence work.** Before you spec an executor to *implement*, check whether the change is in the design-first class — the design-doc skill owns that test, not this one. If so, get a design doc produced and flagged for review *first* — not an implementation. Route the authoring like any design decision (the advisor when /consult is active), hold it to the design-doc skill's method if that skill is enabled, then stop for the user to launch the review; only spec the implementation once the design is settled. Local, single-site, or easily-tested changes go straight to an executor.
- **Parallelize.** Spawn independent tasks in a single message so they run concurrently. Use `isolation: "worktree"` when parallel executors would mutate overlapping files; sequence them otherwise. Two tasks that touch the same shared primitive are entangled, not independent — the delivery skill's entanglement rule governs; sequence them regardless of isolation.
- **Continue, don't respawn.** Use SendMessage to follow up with an executor whose context is still relevant (fixing review findings in its own diff); spawn fresh for new tasks.
- **Review before accepting.** Read the actual diff yourself — never accept an executor's summary on faith; your own review is already the strongest check in the loop. The standard pre-merge gate beyond your own read is `/code-review`, run at whatever tier the delivery skill's routing calls for (delivery owns the tier policy — see that skill, don't re-derive it here). When `/consult` is active, take a subtle diff to the `lonic-advisor-high` as a targeted, named-risk question — this complements `/code-review`, it doesn't replace it. Never spawn a `lonic-exec-*` agent as a reviewer: a sonnet executor reviewing another sonnet executor's diff is a redundant, not an adversarial, channel.
- **Verify before done.** Evidence (test output, build results) must come from an executor's report or your own read-only checks; if it's missing, send the executor back for it.
- **Keep your context lean.** Executors return concise structured reports, not transcripts. Don't re-do their searches yourself; don't paste large file contents into specs when a path reference suffices.
- **Escalate, don't grind.** If an executor fails twice on the same problem, stop, rethink the decomposition or tier/model choice, and re-spec — don't keep resending the same instruction.
- **Check the tree before respawning.** If an executor's report is empty, cut off, or clearly wedged, check the working tree yourself before concluding the task failed — the wedge is typically in the executor's launch-and-wait handoff on a long-running command, not in the work itself, and the code changes are often already complete and correct on disk with only the verification and report missing. Blind re-spawning risks clobbering correct work.
- **Cap expected executor runtime at ~30–45 minutes.** Long orchestrator idle gaps risk expiring the session's prompt cache (~1h TTL), making the resume expensive. Don't shrink naturally short tasks — spawn overhead is real — but when a single task would plausibly run 45+ minutes, split it into staged legs: spawn leg 2 after reviewing leg 1, or SendMessage a mid-task checkpoint ("report progress and pause for review"). Each orchestrator turn between legs refreshes the cache for free and doubles as an earlier review point. When a long leg is genuinely unavoidable (an hour-plus benchmark or migration that can't be checkpointed) and your history is already large, tell the user before spawning that this is a good `/compact` point — you cannot compact yourself, but a pre-handoff compaction caps the cost of a cold resume at the compacted size. Don't suggest it before short handoffs: compaction discards the warm cache and pays a fresh write, so it only pays off when the wait will plausibly outlive the cache TTL.

## Composing with /consult

If the user also enables `/consult` in this session, the modes stack: you remain the orchestrator (executors do all execution), and the `lonic-advisor-high` agent becomes available for *your own* judgment moments — decomposing gnarly problems, design decisions you'd otherwise make alone, and adversarial review of executor diffs too subtle to trust your own read. Consult's "you remain the executor" line does not apply while orchestrate is active. The advisor is an escalation of *judgment*; executors are an escalation of *effort* — never send the advisor to do executor work or vice versa.

Executors never consult the advisor directly — they are instructed to stop and report when blocked or when the spec doesn't match reality. When an executor reports such a wall, triage before spending: usually the answer is a better spec or a tier bump; consult the advisor only when the *decomposition or design itself* is now in question. When you do consult about an executor's problem, fold the executor's report into the context package — the advisor can't see executor transcripts.
