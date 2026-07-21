# agent-skills

Composable workflow skills for high-rigor engineering — planning, delegation, design review, and disciplined shipping — that tighten with use. Built for **Claude Code** today; the portable doctrines are written to travel to other coding tools (Codex, …) as they're ported, which is why installs are namespaced per tool (`claude`).

The headline is **`/powerup`**: one command that switches the whole disciplined workflow on for a session.

## `/powerup` — full-rigor mode (start here)

Enabling `/powerup` activates all five skills below at once, plus the composition rules none of them state alone. In this mode the assistant:

- **orchestrates** — stays in the planning-and-review seat and hands execution to subagents, so big changes stay reviewable;
- **consults an advisor** — pulls in a more capable model for the calls where judgment is the bottleneck;
- **designs before coding** — when the work involves real design decisions, writes a grounded design doc and stops for your review before implementing;
- **ships with discipline** — the home for the shipping doctrines that keep work high-quality, efficient, and stable as it lands;
- **learns** — when a pattern recurs, proposes folding it into these skills (with your sign-off) instead of drifting.

Every skill also works on its own; `/powerup` just turns them all on together.

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

Six subagents the skills spawn, under `claude/agents/`:

- `lonic-exec-{medium,high,xhigh}` — executors for `orchestrate`, by reasoning effort (medium = mechanical, high = default, xhigh = gnarly).
- `lonic-advisor-{medium,high,xhigh}` — the read-only advisor for `consult`, by effort.

The `lonic-` prefix is a brand namespace so these don't collide with your own agents. Model names (Fable / Opus / Sonnet) are Anthropic-specific — the advisor's **model and default effort are a per-user preference** stored at `~/.claude/lonic/advisor.md`; `consult` asks once on first use (recommending Fable, with its plan/cost caveats, and Opus as the strong alternative) and remembers.

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
