# agent-skills

Composable workflow skills for high-rigor engineering — planning, delegation, design review, and disciplined shipping — that tighten with use. Built for **Claude Code** today; the portable doctrines are written to travel to other coding tools (Codex, …) as they're ported, which is why installs are namespaced per tool (`claude`).

The headline is **`/powerup`**: one command that switches the whole disciplined workflow on for a session.

## `/powerup` — full-rigor mode (start here)

Enabling `/powerup` activates all five skills below at once, plus the composition rules none of them state alone. In this mode the assistant:

- **orchestrates** — stays in the planning-and-review seat and hands execution to subagents, so big changes stay reviewable;
- **consults an advisor** — pulls in a more capable model for the calls where judgment is the bottleneck;
- **designs before coding** — when the work involves real design decisions, produces a grounded design first and stops for your review before implementing (with [tetel](https://github.com/lonic-software/tetel) installed, that design is authored against captured evidence and independently graded — see below);
- **ships with discipline** — the home for the shipping doctrines that keep work high-quality, efficient, and stable as it lands;
- **learns** — when a pattern recurs, proposes folding it into these skills (with your sign-off) instead of drifting.

Every skill also works on its own; `/powerup` just turns them all on together.

## Recommended: pair it with [tetel](https://github.com/lonic-software/tetel)

**[tetel](https://github.com/lonic-software/tetel)** — *making AI-authored design work consistent with itself* — is the strongest single upgrade to what these skills produce. It is a separate MCP server, installed separately; `/powerup` detects it and routes design work to it automatically.

Without it, a design doc is prose an agent wrote and an agent reviewed. Nothing distinguishes a sentence the author checked from one it inferred, and reviewers argue with the reasoning instead of opening the file — the exact failure `design-doc` exists to fight, fought with prose alone.

With it, the design is built inside a tetel workspace where that distinction is mechanical:

- **Every factual claim carries evidence the tool captured** — a file span it read, a command it ran — rather than text anyone typed. Claims that cite nothing are refused at authoring time, not caught at review time.
- **An independent pass re-derives each claim from source**, given the proposition and nothing else — the author's framing withheld — and grades it. A second, adversarial pass attacks what the claims *jointly* support.
- **Judgement never turns into a score.** Findings land in a human-owed partition that never silently passes the run; there is no green wall to hide behind.

Then `/powerup` hands you a design that survived that loop, or an explicit statement that one could not be produced. The second answer is the more useful of the two, and prose review does not generate it.

**Why this improves more than your design docs.** Design quality is upstream of everything: the implementation is built from the design, so a design that was never checked against the code propagates into code that inherits its wrong assumptions. tetel improves the design **directly** and the resulting implementation, tests, and review rounds **indirectly** — which is where most of the benefit actually lands, because that is where most of the work is.

Three of the agents in this repo (`lonic-designer`, `lonic-grounder`, `lonic-design-attacker`) exist only to drive that loop and do nothing without tetel installed. Everything else here works unchanged with or without it — `/powerup` falls back to grounded design docs written the `design-doc` way.

## The skills

| Skill | What it does | Portability |
|---|---|---|
| **powerup** | Turns the whole disciplined workflow on for a session — every skill below, plus the rules for how they work together | Claude Code (the Skill/agent machinery) |
| **orchestrate** | Keeps planning and review in your main session and hands the actual editing to subagents, so large changes stay reviewable | Claude Code (subagents, worktrees, model tiers) |
| **consult** | Brings in a second, more capable model for the moments where judgment — not typing — is the bottleneck | Claude Code mechanics; the *when-to-consult* doctrine is portable |
| **design-doc** | Insists on a grounded design doc before code when the work involves real design decisions, so the load-bearing assumptions surface and get tested before they cost you | **Portable** — near-pure engineering method |
| **delivery** | The home for the shipping doctrines that keep work high-quality, efficient, and stable as it lands | Mostly portable; the review-routing section is built on `/code-review` |
| **evolve** | Lets a recurring pattern harden into a durable rule, so the skills sharpen with use instead of drifting | Portable idea; the advisor-gate + memory system are Claude Code |

Everything lives under `claude/` because even the doctrine-heavy skills reference Claude Code constructs (the `/code-review` command, the advisor agent, the memory system). The **engineering principles** inside `design-doc` / `delivery` / `evolve` carry over to any agent framework; the **mechanics** don't. If this repo ever grows a non-Claude implementation, those doctrines are the parts worth porting.

## The agents

Nine subagents the skills spawn, under `claude/agents/`:

- `lonic-exec-{medium,high,xhigh}` — executors for `orchestrate`, by reasoning effort (medium = mechanical, high = default, xhigh = gnarly). Sonnet.
- `lonic-advisor-{medium,high,xhigh}` — the read-only advisor for `consult`, by effort.
- `lonic-designer`, `lonic-grounder`, `lonic-design-attacker` — the [tetel](https://github.com/lonic-software/tetel) design loop: the designer authors against captured evidence, the grounder re-derives each claim from source with the author's scope withheld, and the attacker attacks what the claims jointly support. **These three require tetel** and are inert without it; the other six are unaffected.

The `lonic-` prefix is a brand namespace so these don't collide with your own agents.

Model names (Fable / Opus / Sonnet) are Anthropic-specific. The three design agents run on **Opus** deliberately: they are long, tool-heavy loops, and running them on Fable was measured consuming an extreme amount of tokens for the same work — not a default anyone should inherit. The advisor is the opposite case, being consulted rarely and for judgment only, so its **model and default effort are a per-user preference** stored at `~/.claude/lonic/advisor.md`; `consult` asks once on first use (recommending Fable, with its plan/cost caveats, and Opus as the strong alternative) and remembers.

## Install

### With [pult](https://github.com/lonic-software/pult) (recommended)

This repo is a pult module — run its installer straight from the source, no clone and no manifest, with `pult x`:

```sh
pult x github.com/lonic-software/agent-skills install
```

Drop the trailing args for the guided flow: `pult x github.com/lonic-software/agent-skills` lists the tools (currently only `claude`) and then the skills, with **powerup** on top. A bare source takes the latest tag; pin explicitly with `@v1` if you want.

Selecting **powerup** installs the full bundle (all five skills + their agents); selecting a single skill installs just that one and the agents it needs.

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
```

(Overwrites any same-named skills/agents you already have — the skill names are unprefixed.) Then start a session and run `/powerup`, or enable any single skill by name. On the first consult it will ask your preferred advisor model and effort and save them.

## License

See [LICENSE](LICENSE).
