---
name: consult
description: "Explicit consult mode: use an advisor for high-leverage decisions and adversarial review. The main agent remains the author."
---


# Consult mode

On activation, tell the user that consult is on: you remain the author and use
an advisor for judgment, debugging strategy, and adversarial review.

## When to consult

Consult when the cost of a wrong decision exceeds the cost of the consultation:
lasting architecture or interface choices, difficult debugging, subtle diffs,
and plans expensive to redo. For design-class work, you author the design and
the advisor attacks it. Checking facts yourself does not replace that attack.
Send the design's load-bearing claims and the joints between decisions. Ask
which attacks failed as well as which findings survived.

Read code or documentation yourself for straightforward factual questions.
Do not consult as a rubber stamp or delegate routine implementation.

## Model preference and tiers

Read `.codex/lonic/advisor.json` relative to the project root if it exists.
Fields are `model` (an exact Codex model ID) and `default_effort` (low, medium,
high, or xhigh). Before the first consultation, resolve a missing preference
from the user's current instructions or ask once. Recommend medium effort;
use a model available to the user. Do not invent entitlements, prices, or a
claim that the selected advisor is stronger or cheaper than the main model.
Persist the preference only if the user authorizes saving it. A model failure
requires reporting and a new choice, not a silent substitution.

| Agent | Effort | Use |
|---|---|---|
| lonic-advisor-low | low | Narrow question with an answer the caller can check. |
| lonic-advisor-medium | medium | Baseline; a candidate answer can be evaluated. |
| lonic-advisor-high | high | Escalation when the lower tier cannot resolve an open question. |
| lonic-advisor-xhigh | xhigh | Correctness-critical cases where high was insufficient. |

Start at the agreed baseline. Drop to low only for checkable answers. Escalate
on evidence from the lower tier, not a hunch. Keep effort fixed for an agent's
lifetime. A different tier requires a new agent with an explicit handoff.

## Codex dispatch

Use `collaboration.spawn_agent` with the matching `agent_type`, the chosen
`model`, and `fork_turns: "none"`. Each agent definition pins its effort.
Send the decision, constraints, candidate answer, prior attempts, exact source
paths, and the question. No parent history is inherited; include what matters.

Use one advisor per problem. For subsequent rounds, use
`collaboration.followup_task` on that same target after it completes. Use
`send_message` to steer a running agent and `wait_agent` to wait. Work on
independent tasks while waiting. If the role or continuation tool is absent,
report the missing capability; do not claim that a fresh replacement resumed.

Give a resumed advisor the delta and request judgment of the fixes and their
consequences. Use a new agent for an unrelated problem. Do not ping to keep a
cache warm. Claude cache TTLs and price multipliers are not Codex guarantees.
Report the actual model, effort, reason for the call, and what changed because
of it. Never label an unverified model selection as the actual model.

## Role boundary

The advisor must not edit files or run mutating commands. Its permitted tetel
operations are query, check, review, brief, and workspaces. In Codex, this is
an operating instruction: a native custom agent inherits session permissions
and MCP servers. Do not claim a separate enforced read-only sandbox or a
per-agent MCP allowlist. If the task requires such enforcement, stop that
consultation until an enforceable configuration is available.

You implement and verify the recommendation. Advice is not evidence. A
design requiring the tetel grounder must still satisfy that workflow's stronger
isolation requirement; an advisor is not a substitute for it.
