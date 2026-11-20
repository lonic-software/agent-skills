# Powerup: rationale

The evidence behind powerup's rules. `SKILL.md` holds the rules; this file is read only when
changing them (evolve).

## The author is not an orchestrator

Delegating mutation to executors was adopted to save cost and did the opposite. The first
diagnosis was cold starts. A later measurement (2026-09-18, three orchestrate-era sessions) found
that spawn-time cache writes were ≈0% of executor cost and re-reads were ≈86%. Executors lived ~177
turns each and reached a context of 206k at the median and 967k at the maximum, while the
orchestrator grew beside them (median 370k). Delegation moved the growing context; it did not bound
it.

## Cache lifetimes

- Subagent 5-minute cache, confirmed in two design sessions' transcripts: resumes ≤4.3 minutes
  after the agent's last request were warm, ≥6.4 minutes rebuilt, e.g. ~300k for the attacker,
  twice.
- A measured blanket 1-hour TTL for subagents was 8.6% *worse* (anthropics/claude-code#74318),
  because most subagent cache reuse happens within seconds.
- Reviewers around 100k: a cold-resumed round cost 160–260k and a fresh round 190–310k.
- Verified both ways: a completed `/code-review` agent resumes with its diff, mutation runs and
  findings intact, and a repeat `Skill` or `Agent` call starts a new agent.

## Bound every context

In one measured design session, re-reads were ~80% of the session, and all agent cache writes
together were roughly an eighth of the main thread's re-reads.

## Not while the user is talking

Twice a handoff cleared the session before the user could read the reply (user, 2026-11-20).
