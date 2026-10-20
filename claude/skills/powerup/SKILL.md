---
description: Full-rigor mode — activates consult, design-doc, delivery, and evolve together for the rest of the session, plus the composition rules they don't state on their own. You author; loops keep their rounds but reuse their agents. User-invoked only.
disable-model-invocation: true
---

# Powerup mode

**When this skill is enabled, open your response by telling the user, in 2–3 sentences:**
Powerup is on — full-rigor mode: design-first for design-class work, the delivery shipping
disciplines, a resumed advisor for judgment calls, and the evolve learning loop. **I do the work
myself** — code, tests and designs — and use review and grounding loops to converge, reusing the same
agent across rounds rather than spawning a fresh one each time. Design-class work goes through
tetel whenever it is installed — that is not a choice to offer (design-doc's routing).

Read `${CLAUDE_SKILL_DIR}/../consult/SKILL.md`, `${CLAUDE_SKILL_DIR}/../design-doc/SKILL.md`,
`${CLAUDE_SKILL_DIR}/../delivery/SKILL.md`, and `${CLAUDE_SKILL_DIR}/../evolve/SKILL.md` now, in full. They carry
`disable-model-invocation: true`, so this is the only way to activate them together — reading them
here is what puts them in force; nothing below substitutes for reading them.

Every conditional inside them — "if `/consult` is active," "if an advisor mode is active" — resolves
to **true**. What follows is the composition detail none of them states on its own.

**Names.** Installed as the `lonic` plugin, every command and agent these skills name carries a `lonic:` prefix (`/lonic:powerup`, `lonic:lonic-advisor-medium`). Use the form your session lists. In a
handoff prompt, use the form that started this session.

## You are the author, not an orchestrator

**This reverses the previous arrangement, deliberately, on a measured result, though not for the
reason first recorded.** Delegating mutation to executors was adopted to save cost and did the
opposite. The first diagnosis was cold starts. A later measurement (2026-09-18, three orchestrate-era
sessions) found that spawn-time cache writes were ≈0% of executor cost and re-reads were ≈86%.
Executors lived ~177 turns each and reached a context of 206k at the median and 967k at the maximum,
while the orchestrator grew beside them (median 370k). Delegation moved the growing context; it did
not bound it. The authoring rule stands on the grounds below. The cost rule is *Bound every context*.

**You are the warm cache.** Your context persists across the session and is already primed with the
repository, its conventions and the history of the work. Every fresh subagent pays full price to build
a worse copy of it. So:

- **Write the code, the tests, the migrations and the designs yourself.** There is no executor tier.
- **The `orchestrate` skill and the `lonic-exec-*` agents are retired**.
  There is nothing to delegate mutation to, by design.
- A second failure mode disappears with the tier: **the wrong brief.** Findings used to travel from a
  reviewer, through your transcription, into an executor — and a conclusion stated confidently in a
  brief is exactly what stops the recipient checking it. When you hold the finding and make the edit,
  that hop does not exist.

## Loops keep their rounds. Agents keep their context.

**Do not cut rounds to save money, and do not fix their number either.** Convergence is the quality
mechanism and one pass is never enough — but a round count is not the rule and never was.

**The stopping rule is: no blocker findings remain.** A blocker is **for a design** a finding that
changes *what gets built*; **for code** a finding that affects the *semantics* of the code. Everything
else is recorded and fixed but buys no further round. `design-doc`'s "When the loop stops" owns the
design side in full — do not restate it here. A reviewer always returns *something*; the count is
noise and the class is the signal.

The waste was never the rounds. It was **conflating "fresh agent" with "independent round."**

- **Resume while the agent's cache is warm, and check the gap instead of guessing.** `SendMessage`
  keeps an agent's context, but a resume re-reads it at 0.1x only while the agent's prompt cache is
  alive; after that it rebuilds the whole context at write price. **Subagents default to a 5-minute
  cache, and the main thread gets an hour** (Claude Code docs, *How Claude Code uses prompt caching*;
  confirmed in two design sessions' transcripts: resumes ≤4.3 minutes after the agent's last request were warm,
  ≥6.4 minutes rebuilt, e.g. ~300k for the attacker, twice). So:
  - **Only the design attacker and the grounder carry `experimental: cacheTtl: 1h`**: they are the
    agents resumed after a revision, which fits inside an hour. A 1-hour write costs 2x instead of
    1.25x, so it pays only for an agent resumed after more than five minutes. Everything else stays
    at 5 minutes: all four advisor tiers (mostly one-off consultations), reviewers (usually one
    round, and a forked `/code-review` takes no per-agent setting). Do not widen it: a measured
    blanket 1-hour TTL for subagents was 8.6% *worse* (anthropics/claude-code#74318), because most
    subagent cache reuse happens within seconds.
  - **Before resuming, read the gap:** the timestamp of the agent's last assistant line in its
    transcript (`<session>/subagents/agent-<id>.jsonl`) against `date`. You have no clock of your own.
  - **Once an agent is cold** (past its TTL), resume only when the rebuild, about 1.25x its context
    (2x on a 1-hour agent), is less than what a fresh agent would read to answer the same question.
    Measured for reviewers around 100k: a cold-resumed round cost 160–260k and a fresh round 190–310k,
    so resume. A fresh replacement is briefed as a fresh agent, not with a delta. A grounder gets the
    memo path and a workspace name and nothing else; a reviewer gets the full block delivery §B
    requires.
  - Never ping an agent to keep it warm.

  Verified both ways: a completed `/code-review` agent resumes with its diff, mutation runs and
  findings intact, and a repeat `Skill` or `Agent` call starts a new agent.

- **Round 2 onward is scoped to the delta.** "Here is what I changed in response; judge the fixes and
  what they broke." Never re-post material the agent already has. A fresh replacement is briefed as
  fresh instead (see the bullet above).
- **A brief to a resumed agent is a paragraph, not a page.** It knows the material. Long briefs were an
  artefact of blank agents, and they are where transcription errors entered.
- **Close together means inside the agent's TTL:** an hour for the design passes,
  five minutes for advisors and reviewers. Outside it, the resume is a rebuild, and the first bullet decides
  whether to pay for it.

- **One agent per role per piece of work.** Not two agents split across halves of the same
  question: the second half would lack what the first learned.

**Bound every context: the expense is carrying, not establishing.** Cost is roughly the number of
turns times the context each turn re-reads, summed over every agent alive. A cache read is 0.1x base
input, but a 300k context re-read on each of 100 turns is 3M input-equivalent. In one measured design session, re-reads were
~80% of the session, and all agent cache writes together were roughly an eighth of the main thread's
re-reads. So:

- **An agent's job is short and returns something small.** Delegation pays when an agent reads a
  bounded amount and hands back a conclusion: a search, one slice's review, one grounding pass. It
  does not pay when it only moves a growing context somewhere else. That was the executor tier's
  failure.
- **A phase boundary is a fresh session, not a compaction.** Anthropic's own guidance is to write
  the spec, then "start a fresh session to execute it": `/clear` itself costs nothing, while
  `/compact` is itself a large request; what a fresh session costs is the rebuild, weighed in the next
  bullet. The boundaries are the end of a design, and each slice merged. At one, first make sure
  everything the next phase needs is on disk: the memo, the sequencing row, commits, delivery notes,
  owed actions. Then **hand off**: call the `handoff` tool (the `phase-handoff` mod) as your last
  action and end the turn — its description says what `prompt` must be; add that the prompt starts
  with `/powerup` and names the files the next phase reads first, in order. The user gets a countdown
  to cancel; then the session clears and the prompt opens the next one. If the tool is not
  registered, tell the user it is a boundary and give that prompt instead. `autoCompactWindow` (250k)
  is only the safety net for a session that runs long anyway. A finding that exists only in context
  is one boundary from gone.
- **A handoff is not free: weigh it.** Continuing re-reads the whole context C on every turn at 0.1x.
  A fresh session writes once what the next phase needs, R, at 2x (the main thread's 1-hour cache),
  then re-reads only that. Over N further turns the handoff pays when N × 0.1 × (C − R) > 2R, that is
  N > 20R / (C − R): at C = 300k and R = 60k, after 5 turns; at C = 120k and R = 80k, only after 40.
  Don't guess C: the `context` tool (same mod) reads it, and given `next_phase_tokens` = R it returns
  the break-even.
  So hand off when the next phase is long and needs little of what is in context, which the end of a
  design and a merged slice usually are. Don't when the remaining work is a few turns or needs most
  of the context (R close to C). Estimate R from the files the next phase must read, not from what
  you remember, and start at ~30k: a `/powerup` opening re-reads the five skills and CLAUDE.md before
  any project file.
- **Test output is filtered before it reaches context** when the opt-in PreToolUse hook
  (`~/.claude/hooks/filter-test-output.sh`) is installed: it shows only failures and summaries for long runs of
  un-piped test commands. Put `FULL_TEST_OUTPUT=1` in the command when the full output is needed.

**Effort: start low, and know which way it cuts.** Newer models deliver at low and medium what older
ones needed high or xhigh for — documented for Fable 5 and Sonnet 5, and it holds at least as well for
their successors. The docs name subagents as `low`'s typical case. Lower effort also compounds with the
caching above: it produces *fewer and terser tool calls*, so context grows more slowly and every
re-send is smaller.

**But that same property is the reason not to lower everything.** Fewer tool calls is a saving where
the work is *reasoning over material already in hand*, and a loss where the work is *gathering* it. A
grounder and an attacker exist to investigate — their value is the thoroughness of the search, which is
exactly what low effort trims. Keep the investigative passes at medium; take low freely for summarising
and verifying work. The advisor's tier follows consult's table — medium by default. If you want to lower an investigative pass, measure it: run one pass at
low against a case whose medium result you already have.

**Never vary effort within one agent's life.** Effort is pinned per agent definition; pick the tier
when you spawn.

**One risk reuse introduces, and its counter.** A resumed agent may anchor on a verdict it already gave
and skip re-examining it. Under tetel this is handled structurally — revising a claim puts it out of
proof and forces a regrade. Code review has no such forcing function, so **name the changed regions
explicitly** each round rather than trusting the reviewer to re-derive them.

## Where design-class work goes

**You author the design.** `design-doc` owns the method and the routing — tetel's loop where it is
installed, the hand-written ledger where it is not — including which claims are worth a grounding pass
and which no bound pass can reach. Do not restate any of it here.

**The advisor is the adversarial read** — `consult` owns the mechanics. One instance per problem,
resumed through it; a fresh one for an unrelated problem, because across problems it anchors on
positions it already took. Point it at the load-bearing claims and at the joints between decisions,
never at the whole ledger.

`design-doc`'s rules about *when* a design is required and *who reviews it* still govern — the loop
is the review. Never ask the user whether they have reviewed a design, and never write a user review
into a handoff prompt or memory.

| Role | Owns |
|---|---|
| You | Authoring — code, tests, migrations, designs. Running the loops. Integration. Grading claims no bound pass can reach. |
| Advisor (one per problem, resumed while warm; 5-minute cache) | Adversarial review of designs and subtle diffs; judgment calls at high-leverage moments |
| Grounder (one per design, resumed; 1-hour cache; fresh past it — memo path and workspace name only) | Independent verdicts on claims about the tree, memo withheld |
| Reviewer (one per change; resumed while warm or small, else fresh with the full delivery §B block) | `/code-review` at or below the medium cap — see `delivery` §B |
| User | Names a tier above the medium cap on the rare occasion one is wanted, gates doctrine changes (evolve) |

**The cap still holds.** `delivery` §B owns review tiering and nothing here loosens it: medium is the
ceiling for anything you launch yourself, and pressure to exceed it is a symptom of an unscoped diff or
a skipped design, not of a tier set too low.
