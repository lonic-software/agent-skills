---
description: Design-doc mode — a standing session rule (not "write one now"): from now on, high-consequence changes get a design doc before code, and every design doc holds each load-bearing claim to verified source, a falsifying test, or an explicit unverified tag. User-invoked only.
disable-model-invocation: true
---

# Design-doc mode

**When this skill is enabled, open your response by telling the user, in 1–2 sentences:**
Design-doc mode is on — for design-first work (durability, concurrency, shared primitives, new
invariants) I'll write a grounded design doc first, every claim cited to source, and close it through
attack and grounding rounds before implementing.

Enabling this skill sets a rule for the rest of the session; it is **not** a request to write a
design doc right now. From now on: a change in the design-first class (next section) gets a design
doc *before* the code, and every design doc you write follows the method below.

**There are two ways to write one, and they have different reviewers.** Check which you are in
before you start, because the wrong one wastes a review round:

- **tetel is installed** (the `mcp__tetel__*` tools are available) → the design is authored and
  reviewed *inside the loop* described under **The grounding loop** (`loop-tetel.md`, beside this file). Grounders grade each
  claim against source, an attacker attacks what the claims jointly support, and findings arrive as
  records against claim ids rather than as a report somebody reconciles by hand. The loop's own
  stopping rule ends the design phase. **Do not also run `/code-review` on the doc** — it is a
  weaker instrument for the same artifact, and by the time the loop stops, the memo has been graded
  by more independent passes than a review round supplies.
- **tetel is not installed** → this is the fallback, and the method in `method.md` (beside this file) — the claims ledger,
  the spike ledger and falsifying tests — is how you get the same discipline by hand. You launch
  `/code-review` on the doc yourself, under `delivery` §B's medium cap, alongside the advisor's
  attack where consult mode is on, and revise until the rule under **When the design phase ends**
  fires.

**The route is decided by the two bullets above, never by asking.** Do not offer the user a choice
and do not wait for an opt-in. "Installed" includes deferred tools: if `mcp__tetel__*` names appear
in the deferred-tool list, load them and take the tetel route.

**Design route preference (`~/.claude/lonic/design.md`).** A user may record that they want tetel,
in the same human-editable form as consult's advisor preference:

```
route: tetel
```

- **Absent file** → availability alone decides, as above. Do not ask the user to create one.
- **"I prefer tetel for design"** (or similar) → create or update the file.
- **File says `tetel` and tetel is not installed, or is failing** (the tools absent, the server not
  answering, `brief`/`run` erroring past a retry) → **stop and tell the user** what is missing or
  failing, before any design work. Do not silently fall back to the hand-written route; fall back
  only when the user says to, for that design.
- **Without the file**, a tetel failure mid-design is still reported to the user before you
  continue; whether to fall back is your call.

**Neither path includes a user review.** The rounds are the review; the user does not read the
design before implementation, and nothing here waits for them to. The decisions no source can settle
are the exception, and they are decisions, not reviews: see "Dispatch rules" and, for a UI, "Frontend
work: the design system comes first".


The rest of this skill — this file and the two beside it — applies to both routes. The method is
the same; only who checks it differs.

## When a design doc comes before code

A design doc is cheap insurance: being wrong on paper costs a text edit and a re-read; being wrong
in merged code costs a rewrite plus its tests plus another review. Front-load a doc when that gap
is wide — and skip it when it isn't.

**Write the doc first when any of these hold:**

- **The cost of being wrong is architectural, not local.** If getting it wrong means reshaping
  code rather than patching a line, the mistake is far cheaper to find on paper.
- **The change is cross-cutting.** A shared primitive, many call sites, or a new contract other
  code will depend on — the "fix the class, not the instance" shape.
- **The failure modes resist testing.** Races, crash windows, cross-process or interleaved states,
  rare error paths — anything a normal unit test won't reliably exercise. Design review catches
  "this invariant is false / these pieces don't compose"; code review catches "this line does the
  wrong thing." Running `/code-review` on the design doc and later on the implementation diff are
  two reviews of two artifacts, finding those two different classes — neither substitutes for the
  other.
- **You're choosing between genuinely different approaches** and the choice is expensive to reverse
  once built.

Durability, concurrency, on-disk formats, and protocols are where these bite most often — but the
criteria above are the trigger, not the domain. The same rule fires for a scheduling policy, a
caching layer, or a permissions model.

**Go straight to code + review when none hold:** local, single-site, mechanical, or easily
unit-tested changes — a rename, boilerplate, a well-understood feature with no novel contract. A
design doc there is pure ceremony.

Two shape tripwires while drafting: the mechanism sections outweigh the contract sections, or the
doc approaches the size of the diff it will describe. Either is the same signal delivery §C reads
from escalating review rounds — stop, cut the doc back to decisions and observables, and move the
mechanism to the spike list or the implementation checklist.

This skill exists because of one repeatedly-observed failure: a design doc states something about
the code as a step in an argument, nobody notices it is a checkable fact rather than reasoning,
and it survives several rounds of adversarial review intact because reviewers argue with the
reasoning instead of opening the file.

## Frontend work: the design system comes first

A UI's visual language — its tokens (colour, type, spacing, radius, elevation, motion), its components
and their states, and its layout rules — is a decision no source can settle, the same class as a stack
or a product feature set (see "Dispatch rules that are not negotiable"). So it is **settled with the
user**, not authored and closed by the loop. This is the user deciding, not the user reviewing a
design: "Neither path includes a user review" still covers everything else, the screens' own design
included. Data flow, state and contracts follow the ordinary design-first rules.

- **When it applies.**
  - **A new UI: always.** The design system exists, settled, before any screen is built.
  - **A UI that already has a design system: always.** If the work needs something the system lacks,
    such as a new kind of component, a new token or a new pattern, it goes into the system first and
    is settled with the user. The screen then uses it from there.
  - **An existing UI with no design system: only when the user explicitly asks.**
    Do not propose a retrofit as a side effect of other work.
- **The artifact is an HTML page** that renders every token and every component in each of its
  states, in light and dark if the UI has both. The user looks at it, rather than reading prose
  about it. It lives in the repo that ships the UI, because the implementation is checked against
  it. Render-check it before showing it.
- **Settled means the user said so.** Iterate on the page with the user until they accept it, and
  their acceptance is the close. No attacker or grounder grades it.
- **Then the whole UI follows it.** Every screen is built only from the approved system's tokens and
  components, which is what keeps the UI consistent everywhere. A screen that seems to need a
  one-off, such as a raw colour, a bespoke spacing or a component variant the system lacks, is a
  change to the system and goes back to the user first, never inline. Where the stack allows it,
  enforce this with a mechanism rather than a reminder (delivery §D): for example, a check that
  fails on a colour or size literal outside the token source. A review of a UI diff is
  briefed with the page's path and told to check the diff against it (delivery §B owns the brief).
- **Unattended runs.** Settling the system is a question for the user, so queue-run §1d governs when
  it is asked and when the item is parked. Park it with the draft page ready. The agent never settles
  it alone.

## The one rule

**Cite nothing you have not opened in this session.**

Everything below is scaffolding around that rule. A doc that follows only this rule and none of
the rest is still a good doc. A doc that follows all the scaffolding and violates this one is the
exact failure this skill exists to prevent — worse than no doc, because it reads as rigorous.

"Opened" means you read the actual lines, this session, at the path and line you are about to
cite. Not "I recall that function," not "the other memo says," not "a subagent reported."
Line numbers drift; files get split; a citation into a file shorter than the line number you
wrote is a real thing that has happened.

For a claim about an external system, the thing to open is its installed source where that is on
disk, else its primary documentation — delivery §A
owns that rule — and the citation names the document and section in place of a path and line.

## Read when a design starts

This file is read in full whenever the mode is on: it decides **whether** a change needs a design
and **which route** writes it, and it holds the one rule. The method itself lives in two files beside
this one, read in full **when a design starts** — when the criteria above fire for the work in hand —
not before. Do not cite their rules from memory; open them.

- **`${CLAUDE_SKILL_DIR}/method.md` — every design, either route.** The claims ledger and the
  load-bearing UNKNOWN; the substitution vocabulary; matching each claim to its cheapest falsifier;
  spiking load-bearing claims; pairing every invariant with a falsifying test (and its evidence
  class); honest gaps; downgrading claims that outran their evidence; preconditions and warrants;
  the shape of the doc; two traps that generalize; and **When it is ready** — the close checklist
  and how to report the close.
- **`${CLAUDE_SKILL_DIR}/loop-tetel.md` — the tetel route only.** The grounding loop: authoring the
  memo, answering a verdict, **Dispatch rules that are not negotiable** (including the decisions no
  source can settle, which go to the user), and **When the loop stops**.

The hand-written route needs nothing beyond `method.md`: its reviewer is `/code-review` on the doc,
under delivery §B's medium cap, and it ends by the rule below.

**The loop, in brief** (so the routing above is actionable before `loop-tetel.md` is open): you
author and revise; each round is an attack pass, then your revision, then a grounding pass over what
the revision left owed; passes run synchronously and never overlap; the loop stops when the last
attack pass returned no finding that changes what gets built, capped at four grounding rounds; a
revision no attacker has seen means the next pass is an attacker; and a design that has not been
independently grounded is never reported.

## When the design phase ends

The design phase ends when a review round yields zero decision-changing findings. Per finding, ask:
*what is the cheapest downstream instrument that would catch this?* When every answer is the
compiler, a named test, or code review of the implementation diff, the doc is done — those findings
are real, and they route to the instruments that own them (delivery §B owns the routing), not back
into prose. **Ending the design phase does not predict a light code review.** Mechanism defects
surface at the implementation gates *by design* — moving a defect from prose to a diff is what makes
it real and fixable, not what makes it free. Budget the code-review rounds accordingly; their yield
is the system working, not the stopping rule failing.

A closed design is ready to implement — after the checklist under **When it is ready** in
`method.md`. The end of a design is a phase boundary: `powerup`'s phase-boundary rule owns whether to
hand off there.
