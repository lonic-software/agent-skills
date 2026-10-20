# agent-skills

Composable workflow skills for high-rigor engineering — planning, delegation, design review, and disciplined shipping — that tighten with use. Built for **Claude Code** today; the portable doctrines are written to travel to other coding tools (Codex, …) as they're ported, which is why installs are namespaced per tool (`claude`).

Two headlines:

- **`/powerup`** — one command that switches the whole disciplined workflow on for a session.
- **`/powerup-auto`** — the same workflow, unattended: it works through your project's queue one item per fresh session, at full rigor, until it spends the share of your weekly usage you gave it.

## `/powerup` — full-rigor mode (start here)

Enabling `/powerup` activates `consult`, `design-doc`, `delivery` and `evolve` at once, plus the composition rules none of them state alone. In this mode the assistant:

- **authors the work itself** — code, tests and designs are written in the main session, whose context is already warm, rather than handed to executor subagents that each pay to rebuild a worse copy of it (measured: delegation moved the growing context, it did not bound it). Subagents are kept for review, grounding and advice, and are resumed across rounds instead of respawned;
- **consults an advisor** — pulls in a more capable model for the calls where judgment is the bottleneck;
- **designs before coding** — when the work involves real design decisions, produces a grounded design first and converges it through attack and grounding loops before implementing (with [tetel](https://github.com/lonic-software/tetel) installed, that design is authored against captured evidence and independently graded — see below);
- **ships with discipline** — the home for the shipping doctrines that keep work high-quality, efficient, and stable as it lands;
- **learns** — when a pattern recurs, proposes folding it into these skills (with your sign-off) instead of drifting.

Every skill also works on its own; `/powerup` just turns them all on together.

## `/powerup-auto` — powerup, on autopilot

```text
/powerup-auto stop at 60%
```

`/powerup` makes one session rigorous. `/powerup-auto` keeps that rigor going across a whole backlog without you in the loop:

- **Finds the queue** — your prompt, memory or CLAUDE.md, a `ROADMAP`/`TODO`/`BACKLOG` file in the repo, or the tracker the project points at. If there is more than one candidate, it asks once, up front.
- **One item per fresh session.** Each item is done under full `/powerup`: designed first when it is design-class, reviewed until no blocker findings remain, and shipped with the delivery discipline. At the item boundary it hands off to a clean session, so context never piles up across items.
- **Spends only what you budget.** You set the stop line as a share of weekly usage, either absolute (`stop at 60%`) or relative (`spend 10%`). It checks usage at every boundary, prices multi-agent steps against the remaining headroom, and won't start a review round it can't finish. An item it can't finish is left resumable with its open findings written down. A half-converged round is never treated as done.
- **Merges only with permission.** You choose the merge authority once: merge after review converges and CI is green, open PRs only, or ask each time.
- **Stays steerable.** It re-reads the queue at the start of every item, so reordering the queue mid-run takes effect. Items marked parked or "ask first" are skipped and listed in the final report.

All the questions come at the start, then it runs unattended. It needs the [`phase-handoff` mod](#mods) to chain sessions; without it, every item ends with a ready-to-paste prompt for the next one. `/queue-run` is the same chain without powerup, for working a queue under the project's own workflow.

## Recommended: pair it with [tetel](https://github.com/lonic-software/tetel)

**[tetel](https://github.com/lonic-software/tetel)** — *making AI-authored design work consistent with itself* — is the strongest single upgrade to what these skills produce. It is a separate MCP server, installed separately; `/powerup` detects it and routes design work to it automatically.

Without it, a design doc is prose an agent wrote and an agent reviewed. Nothing distinguishes a sentence the author checked from one it inferred, and reviewers argue with the reasoning instead of opening the file — the exact failure `design-doc` exists to fight, fought with prose alone.

With it, the design is built inside a tetel workspace where that distinction is mechanical:

- **Every factual claim carries evidence the tool captured** — a file span it read, a command it ran — rather than text anyone typed. Claims that cite nothing are refused at authoring time, not caught at review time.
- **An independent pass re-derives each claim from source**, given the proposition and nothing else — the author's framing withheld — and grades it. A second, adversarial pass attacks what the claims *jointly* support.
- **Judgement never turns into a score.** Findings land in a human-owed partition that never silently passes the run; there is no green wall to hide behind.

Then `/powerup` hands you a design that survived that loop, or an explicit statement that one could not be produced. The second answer is the more useful of the two, and prose review does not generate it.

**Why this improves more than your design docs.** Design quality is upstream of everything: the implementation is built from the design, so a design that was never checked against the code propagates into code that inherits its wrong assumptions. tetel improves the design **directly** and the resulting implementation, tests, and review rounds **indirectly** — which is where most of the benefit actually lands, because that is where most of the work is.

Two of the agents in this repo (`lonic-design-attacker`, `lonic-grounder`) exist only to drive that loop and do nothing without tetel installed. Everything else here works unchanged with or without it — `/powerup` falls back to grounded design docs written the `design-doc` way.

## The skills

| Skill | What it does | Portability |
|---|---|---|
| **powerup** | Turns the whole disciplined workflow on for a session — every skill below, plus the rules for how they work together, cache-aware agent reuse, and phase handoffs | Claude Code (the Skill/agent machinery) |
| **consult** | Brings in a second, more capable model for the moments where judgment — not typing — is the bottleneck | Claude Code mechanics; the *when-to-consult* doctrine is portable |
| **design-doc** | Insists on a grounded design doc before code when the work involves real design decisions, so the load-bearing assumptions surface and get tested before they cost you | **Portable** — near-pure engineering method |
| **delivery** | The home for the shipping doctrines that keep work high-quality, efficient, and stable as it lands | Mostly portable; the review-routing section is built on `/code-review` |
| **evolve** | Lets a recurring pattern harden into a durable rule, so the skills sharpen with use instead of drifting | Portable idea; the advisor-gate + memory system are Claude Code |
| **queue-run** | Works through a project's queue unattended, one item per fresh session, until weekly usage reaches a threshold you set for the run (`/queue-run stop at 60%`) | Claude Code; hands off via the `phase-handoff` mod |
| **powerup-auto** | `/powerup` + `/queue-run` in one: the queue, worked at full rigor | As above |

`orchestrate` and its `lonic-exec-*` executors were retired in favour of the main session authoring the work itself; see *You are the author* in `powerup`.

Everything lives under `claude/` because even the doctrine-heavy skills reference Claude Code constructs (the `/code-review` command, the advisor agent, the memory system). The **engineering principles** inside `design-doc` / `delivery` / `evolve` carry over to any agent framework; the **mechanics** don't. If this repo ever grows a non-Claude implementation, those doctrines are the parts worth porting.

## The agents

Six subagents the skills spawn, under `claude/agents/`:

- `lonic-advisor-{low,medium,high,xhigh}` — the read-only advisor for `consult`, by effort (low = narrow questions you can grade at once; medium is the default).
- `lonic-design-attacker`, `lonic-grounder` — the [tetel](https://github.com/lonic-software/tetel) design loop: you author the memo against captured evidence, the attacker attacks what its claims jointly support, and the grounder re-derives each owed claim from source with the author's scope withheld. **These two require tetel** and are inert without it; the advisors are unaffected.

The `lonic-` prefix is a brand namespace so these don't collide with your own agents.

Model names (Fable / Opus / Sonnet) are Anthropic-specific. The two design agents run on **Opus** deliberately: they are long, tool-heavy loops, and running them on Fable was measured consuming an extreme amount of tokens for the same work — not a default anyone should inherit. The advisor is the opposite case, being consulted rarely and for judgment only, so its **model and default effort are a per-user preference** stored at `~/.claude/lonic/advisor.md`; `consult` asks once on first use (recommending Fable, with its plan/cost caveats, and Opus as the strong alternative) and remembers.

## Install

### With [pult](https://github.com/lonic-software/pult) (recommended)

This repo is a pult module — run its installer straight from the source, no clone and no manifest, with `pult x`:

```sh
pult x github.com/lonic-software/agent-skills install
```

Drop the trailing args for the guided flow: `pult x github.com/lonic-software/agent-skills` lists the tools (currently only `claude`) and then the skills, with **powerup** on top. A bare source takes the latest tag; pin explicitly with `@v2` if you want.

Selecting **powerup** installs the full bundle (the five skills, their agents, and the `wait-pr-ci` script `delivery` uses); **powerup-auto** adds `queue-run` and its wrapper on top (add the `phase-handoff` [mod](#mods) to let it chain sessions); selecting a single skill installs just that one and what it needs. **test-filter-hook** copies the hook below and prints the `settings.json` entry to add — the installer never edits your settings.

If you reach for it often, `pult includes add github.com/lonic-software/agent-skills --prefix skills` pins it into your own `pult.yaml` so it's `pult skills:install`. Or `git clone` and run `pult install claude powerup` from inside the checkout.

Works on Linux, macOS, and Windows. `bin/install` is one door: on Linux/macOS it copies the files itself; on Windows it hands off to the bundled PowerShell installer (`bin/install.ps1`) so there's a single Windows code path. Because pult runs commands through `sh -c`, the **pult** path needs **Git Bash** on Windows (which ships `sh`) — with it installed, `pult x … install claude powerup` routes through PowerShell for you.

> Note: pult pickers are single-select and don't (yet) show per-value descriptions, so "install several skills at once" is served by the **powerup** bundle option rather than a multi-select, and each option's meaning lives in the command `description`.

### On Windows without Git Bash (PowerShell)

No Git Bash means pult can't run `sh` at all — run the same PowerShell installer directly (same behaviour, same options):

```powershell
git clone https://github.com/lonic-software/agent-skills
powershell -ExecutionPolicy Bypass -File agent-skills\bin\install.ps1 claude powerup
```

(or `pwsh bin/install.ps1 claude powerup` on PowerShell 7+).

### By hand

Copy into your Claude Code config:

```sh
cp -R claude/skills/*  ~/.claude/skills/
cp    claude/agents/*  ~/.claude/agents/
mkdir -p ~/.claude/bin && cp claude/bin/wait-pr-ci ~/.claude/bin/
```

(Overwrites any same-named skills/agents you already have — the skill names are unprefixed.) Then start a session and run `/powerup`, or enable any single skill by name. On the first consult it will ask your preferred advisor model and effort and save them.

## Mods

`claude/mods/` is a plugin marketplace (`lonic-mods`) with two Claude Code plugins. They are TypeScript loaded straight from source (no build step) against Claude Code's plugin API, which is early-access: it may not be enabled on your account or version.

- **phase-handoff** — a `context` tool that reports context size, cost and rate limits with a handoff break-even, and a `handoff` tool that, at a phase boundary, clears the session and opens the next one with a given prompt after a cancellable countdown. `powerup` and `queue-run` use it; without it they stop and print the next prompt instead.
- **cost-log** — records each turn's token usage per agent and reports cost-equivalents, heavy turns and cache rebuilds (`/cost-log`, `cost_log` tool).

From a checkout:

```sh
claude plugin marketplace add ./claude/mods
claude plugin install phase-handoff@lonic-mods
claude plugin install cost-log@lonic-mods
```

Each has tests (`claude plugin test claude/mods/<plugin>`). The `.claude-plugin/types/` directories are generated by Claude Code and gitignored.

## Test-output filter hook

`claude/hooks/filter-test-output.sh` is a `PreToolUse` hook on Bash that keeps test-runner output out of the model's context: an un-piped `jest`/`vitest`/`npm test`/`pytest`/`go test` command is rewritten to print only failures and summary lines, keeping the runner's exit status. Put `FULL_TEST_OUTPUT=1` in a command to bypass it. Needs `jq`. Install with `install claude test-filter-hook`, then add the printed entry to `~/.claude/settings.json`.

## Keeping a checkout and an install in step

`bin/check-sync claude` (or `pult check-sync claude`) is read-only: it reports which skills, agents, scripts and mods differ between this repo and `~/.claude`, and leaves the direction to you.

## License

See [LICENSE](LICENSE).
