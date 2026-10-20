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
  reviewed *inside the loop* described under **The grounding loop** below. Grounders grade each
  claim against source, an attacker attacks what the claims jointly support, and findings arrive as
  records against claim ids rather than as a report somebody reconciles by hand. The loop's own
  stopping rule ends the design phase. **Do not also run `/code-review` on the doc** — it is a
  weaker instrument for the same artifact, and by the time the loop stops, the memo has been graded
  by more independent passes than a review round supplies.
- **tetel is not installed** → this is the fallback, and everything below about the claims ledger,
  the spike ledger and falsifying tests is how you get the same discipline by hand. You launch
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
design before implementation, and nothing here waits for them to.

The rest of this skill applies to both. The method is the same; only who checks it differs.

## The grounding loop

**Only when tetel is installed.** **You author the memo and you revise it.** The loop is the two
instruments you cannot be — an attacker and a grounder — run around your own work.

1. **You author** in a tetel workspace until the first machine-clean render.
2. **Then, each round, in this order:** an attack pass; then **you revise** to answer whatever it
   returned; then a grounding pass over what the revision left owed (the brief's `owed` line names
   exactly that set).
3. Repeat from 2 until the stopping rule below fires.

**Cost lives in carrying, and a pass stays warm for an hour.** A pass re-reads its whole context on
every turn. The attacker and grounder definitions carry `experimental: cacheTtl: 1h`, so a resume
within an hour of the pass's last request re-reads at 0.1x. The default for subagents is five minutes,
which a revision round always outlasts; that cost one measured design two ~300k rebuilds. Past the hour, a fresh pass
(memo path and workspace name only, as below) is favoured on paper: its predecessor's verdicts are
already records, and `check` counts it as a second independent workspace. Measure it the first time,
since no fresh pass has been costed yet.

**The revision goes between them, not after both.** An attacker that refutes has just established
that some wording is wrong; a grounding pass run beside it grades claims that are about to change,
and a revised claim's earlier gradings no longer match its digest, so those records strand on
arrival. Answer the attack first, then ground what the answer left owed — the brief's `owed` line
names exactly that set.

### Authoring the memo — the rhythm

Run `brief` with `authoring: true` once at the start; **its rhythm section is the rhythm.** `run` the
commit check first and make the pin your first claim. After that there are no phases.

Work in **questions** — one design decision at a time, small enough to settle with a handful of
observations. **Document order is not authoring order**: `prose --before <ID>` places a block where it
belongs, so you never trade a readable memo for an honestly-built one. Deciding a question's *answer*
before observing is the failure this method exists to prevent.

- **Inside a question, `look`/`run` is the read path.** `Read`/`Grep`/`Glob` find *which* file matters;
  the moment you know, switch. Reading a file with `Grep` until you understand it and re-opening it
  with `look` so `fact` has something to point at records the act and loses the finding.
- **Read in ranges, and it matters most at the start.** Anything loaded in the first ~30 tool calls is
  re-read on every later request and charged roughly **15x** its size; the same bytes late cost ~3x.
  Measured across two runs, the opening 30 requests carried **~73%** of the entire tool-result cost.
- **When a fact refuses a direction, that is the method working.** The `--why` on the revision names
  that fact's id, so the refutation becomes load-bearing. Three signatures mean thrashing instead:
  the same decision flips twice with no new fact between the flips; you reach for `fact --revise` on a
  load-bearing fact (facts should almost never be revised, claims often); or a `--why` citing
  preference rather than a fact id.
- **Two reversals of one decision with no new evidence between them means the evidence cannot decide
  it.** Stop. Report both directions, the fact blocking each, and the observation that would
  discriminate. That is a result. Do not take a third option — one chosen under no new evidence was
  chosen by the process that already failed twice.

**The editorial pass mints nothing.** When the last question is settled, `review` every paragraph
beside the claims it cites, then `prose --revise` for flow only. No new facts, no new claims — if the
document needs an assertion it lacks, that sends you back into the loop, not into prose. It also
cannot reorder, so choose placement as you write. This is not tidiness: the highest-severity defect in
this project's first tetel memo was a keystone claim that existed **only in prose**, under a citation
to a claim that said something else, and it entered during exactly such a writing phase. Read the
block ids from `query prose` immediately before any batch of `prose --revise`; never reconstruct them
from memory or by counting. Ids are permanent but positions are not — an inserted block keeps its own
id wherever it lands (`P35` can sit between `P19` and `P20`), so any count is off by one past the
first insertion, and the row number `query prose` prints is a position, not an id. A revise against
the wrong id silently overwrites whatever block holds it; twice in one memo that replaced headings.

Then `render --out`, then `check`. Be machine-clean before spending a grounding pass.

### Answering a verdict

- **`refutes`** → the claim is wrong. **Fix the design, not the wording.** Redesign as far as the
  refutation reaches, keystone included. Rewording a refuted claim until it sounds survivable is the
  failure an under-pressure loop breaks into first.

  **Match the refuter's substrate.** Every witness is a `run`, so its kind tells you nothing — read the
  extent of the witnessing fact and ask: *would its output have been byte-identical on a fresh clone of
  the pinned commit, with no network and no credentials?* If not, it observed the world outside the
  tree, and your replacement must cite a `run` of your own against that same substrate this round.
  Source reads are corroboration, not the instrument. If the substrate cannot be reached, return the
  claim as execution-owed rather than replacing it. **A refutation has jurisdiction over siblings**:
  check every other claim asserting that substrate's behaviour, not only the one the record names.
  Where the witness *was* worktree-determined, answer at the same depth and do not reach for a live
  call the argument settles.
- **`qualifies`** → it holds only under a condition it does not state. State the condition or narrow
  the claim. A qualification naming one clause is a one-clause fix; one about what the grader *could
  not establish* means the design owes more evidence, not better prose.
- **`supports`** → nothing is owed. **Do not revise a supported claim for style** — you would put it
  out of proof and buy another pass to return to where you already were.

### Dispatch rules that are not negotiable

**Spawn every pass synchronously — `run_in_background: false`.** The default runs subagents
detached, which makes the loop unable to wait for the result it exists to read. A designer left in
that state spent **15% of its entire budget** calling `workspaces` in a loop, polling for children it
could not have waited for; the polls' own output then became the single largest thing in its
context. Never poll for an agent.

**Never run the attacker and a grounder at the same time, and run the attacker first.** They
overlapped on 7 of 7 passes in one measured run purely because both were dispatched detached. The
order matters on yield: an attack pass and a grounding pass cost about the same per round (measured
attacker round 0 on two designs: 57 turns in 14 minutes, and 64 turns in 23 minutes), but the attacker
provokes roughly 0.83 revisions per record and a grounding pass 0.06–0.47. Running the high-yield
instrument first means the grounder grades wording that has already survived attack
— and a revision landing mid-pass strands that pass's records, because a revised claim's earlier
gradings no longer match its digest.

**A claim refuted from outside the worktree is answered from outside the worktree.** A record's kind
does not discriminate — every witness is a `run` — so apply the substrate test to the refutation's
witnessing command: would its output have been identical on a fresh clone of the pinned commit, with
no network and no credentials? When it would not — the command interrogated the deployed system, not
the tree — say so when you revise, and a revision whose replacement claims cite no
observation of that substrate is not attacked next: it is rejected and redone. Prose and
source-reads have just been demonstrated to lack jurisdiction over that question, and dispatching
review at its successor re-runs the demonstrated failure. Measured once: three read-mechanism claims
asserted in prose were each refuted against the live system by a later pass — five rounds, ~4.5M
tokens — and four scripts then settled every remaining question in twenty minutes. In that run's
ledger of 155 records, exactly the five refutations witnessed by live-system calls were the mechanism
failures; the ten witnessed from source were contract-level, and this rule stays silent on those.

**Give a grounder the memo path and a fresh workspace name, and nothing else.** No propositions, no
summary of the reasoning, no note about which claims you are unsure of. It runs `brief` itself so
the propositions are byte-identical, and it has no read path into the author's workspace. Every word
you add is a channel for handing over the answer. Name workspaces for the pass — `k1-<design>-grounder`,
then `k2-…`; `a1-<design>-attacker`, then `a2-…` — so independence is recomputed from identity
rather than trusted from a label.

**Send a grounder only claims it can actually reach.** Ground what a claim asserts about *the tree* —
what the code does, what a constraint admits, what exists and what does not. A grounding pass is
barred from reading the design directory, so **a claim that quotes your own planning documents is
ungradable by any bound pass**: the only party who can reach it is you, the least independent one.
Grade those yourself, state the non-independence in the record's note, and let `check` report them as
attested. Better still, rewrite such a claim to assert the tree property it is standing in for — then
a grounder can grade it after all.

**Resume a pass across rounds of the same design; spawn a new one for a new design.** A resumed
grounder keeps its workspace, so `check` still computes it as non-author, and it keeps everything it
learned about the tree, which makes round two faster, and cheap while it is inside its cache
lifetime (above). The cost is real and bounded: `check`
will report **one** distinct non-author workspace rather than several, and a second look by the same
context is weaker evidence than a first look by a new one. Spend a fresh pass where that weakness
would matter — a claim nothing else covers, or one a resumed pass has already graded `supports` and
would now have to contradict itself to refute.

**A designer's brief leads with the deliverable's surface; the open questions come second.** The
question list you attach becomes the scope whether you mean it to or not — the designer answers the
brief it is given, and grounding pulls the same way, because the half of the problem with readable
source outcompetes the half without. One design briefed as "an admin UI" plus five unsettled
substrate questions came back answering all five and containing no feature set, no screens, no auth
model and no data model — and rendered exactly as clean as a complete memo, because nothing in the
artifact distinguishes never-asked from answered. Name the sections a reader would expect the
finished design to contain; anything outside that surface is an explicit deferral in the brief, so a
gap in the memo is a stated deferral rather than a silence. And a decision no source can settle — a
stack, a product feature set — is settled with the user before dispatch: the designer has no channel
to ask, so an unaskable question becomes an omission.

**Run an attacker every round, even when the grounding came back clean** — especially then, since a
clean grounding is exactly the state in which nothing else will question the design. The attacker
was for a long time spawned only to re-validate a refutation's fix, which meant it ran only when a
grounder had refuted something; across four memos nothing ever was, so the highest-yield instrument
in the loop never ran at all. A grounder grades **each proposition as written**, so it structurally
cannot see what the claims fail to establish *jointly*. The two are not substitutes.

**A refutation's fix is re-validated by an attacker, not by a grounder.** A grounder grading the
repaired sentence establishes only that the new sentence is true. It cannot see the defect class a
refutation-fix risks — a fix that is right about the finding and wrong about a premise neither the
finding nor the fix made explicit. That has happened and cost a round: a repair was graded
`supports` twice, correctly, and the next attack pass showed it unsound at its destination.

### When the loop stops

**The signal is that the buildable design has settled — not that the prose has.**

Stop when `check` is machine-clean, nothing is refuted, and **the last attack pass returned no
finding that changes what an implementer would build**: no declared modification target added or
removed, no change to a decision an implementer acts on. Findings that correct *how accurately the
design describes itself* are recorded and do not extend the loop.

That is the same test this skill already applies on the other path — *what is the cheapest downstream
instrument that would catch this?* A wrong decision has no downstream instrument and must be caught
here. A claim that is right in substance and over-claims in one clause will be caught by code review
of the diff, or by the compiler, or by the test the claim names.

**A dry *grounding* round is not the signal.** Grounders being out of ideas is not the design having
settled, and the difference is expensive: on one run, pass 1 was a dry grounding round and the
attacker after it provoked **eight** revisions; passes 5 and 7 were also dry, and their attackers
provoked 8 and 5. Stopping at the first dry round would have discarded 24 of that run's 35 revisions.
If a grounding round comes back dry and no attacker has seen the current text, **the next pass is an
attacker, not a stop.**

**A caveat is not a close.** "No attack pass has seen the answers" written into a close-out report is
the stop condition failing, in writing — the process-level form of the load-bearing UNKNOWN: the
honest label reads as diligence and survives precisely because it was flagged. If revisions landed
after the last attack pass, the next pass is an attacker, at any `check` verdict and any round count;
if it refutes, the design is reported unfinished, not clean-with-a-caveat. Either way the close-out
report states that the final attack pass read the text being closed.

**And an earlier formulation of this rule — "stop when the last round provoked no revision" — is
unreachable, which is why it is gone.** Any round that answers a finding rewrites some wording, which
invalidates the attacker's grading, which requires another attacker, which finds something. Measured
on one loop: refutations fell 2 → 1 → 1 → 0 across four attack passes while qualifications did not
fall at all, because **every revision writes new prose and new prose carries new overreach**. All
three of that run's final qualifications were the same shape — a single clause saying *only*, *never*
or *permanently* about a claim that was right in substance. Iterating cannot drive that to zero; it
manufactures it.

So: refutation and target churn extend the loop. Prose accuracy does not. Once both attack passes and
grounding passes are returning only the second kind, stop — do not run one more round to be sure. One
memo paid for that: two consecutive dry grounding rounds, 55 records between them, nothing changed by
either.

**Make the distinction the attacker's job, not yours.** Ask each attack pass to say, per finding,
whether it changes what gets built or only what the implementer is told. They separate the two
readily; it is the stop decision that needs the separation stated rather than inferred.

**Cap the loop at four grounding rounds.** If it is not clean by then, stop and report plainly which
claims will not survive, what each pass said, and what the design cannot currently establish. An
honest report of an unstable design is a result; a design reported as finished because the loop ran
out of patience is worse than an unstable one, because it arrives with a green attached. The cap
bounds grounding rounds — the expensive instrument — never the closing attack pass. Machine-clean at
the cap with revisions no attacker has seen is not clean; it is unattacked text with a green
attached.

**Machine-clean is the bar, and the human-owed partition is not a queue to empty.** `check` will
always list qualified verdicts, `proc:` extents, self-grounding and its own standing non-coverage.
Surviving qualifications belong in the report, in the grounder's own words.

**Never report a design that has not been independently grounded.**

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

## The claims ledger

Every load-bearing sentence carries one of three tags. Keep them visible while drafting; strip
the tags before the doc ships only if they clutter — the discipline is in the tagging, not the
notation. Stripping removes tag words only: `file:line` citations and the links from each
`ARGUED` claim to its premises are content, not notation, and stay.

| Tag | Means | Requirement |
|---|---|---|
| `VERIFIED` | You opened `file:line` this session and it says what you claim | Cite the path and line |
| `ARGUED` | Follows from named `VERIFIED` facts (or prior `ARGUED` claims) by reasoning you have written down | Name the premises it derives from; the reasoning must be in the doc, not in your head |
| `ASSUMED` | Neither | **May not be load-bearing.** Either verify it, test it, or state plainly that it is unverified |

An `ARGUED` claim names what it stands on — "ARGUED from the §2.1 facts," "ARGUED from the two
`VERIFIED` reads above" — so a reviewer can walk the chain premise by premise. "Follows from
verified facts" with no facts named is exactly where a hidden `ASSUMED` link hides. If you
cannot point at the premises, the claim is not `ARGUED` yet.

**Enumeration claims are tagged by their bound, not their members.** A claim that a set is
complete — "these are the writers to X", "all call sites of Y", "every surface that does Z" — or
empty — "there is no X" — takes its tag from what closes the set:

- `VERIFIED` means the bounding sweep was run **this session** and its output inspected. Cite the
  command itself (e.g. `grep -rn 'Journal::' src/`) and paste its output next to the enumeration,
  so a reviewer can re-run, re-scope, and diff — the same sweep returning different members on a
  re-run is itself a finding, and the citation exists to make a mis-scoped sweep visible, not to
  certify it. An **empty** result is the case to distrust: with no members to inspect, a
  mis-scoped sweep is indistinguishable from a true negative, so an empty-set claim additionally
  states its quantifier domain and the condition under which the sweep must be re-run.
- `ARGUED` means a verified closing mechanism is cited as the thing that closes the set — an
  exhaustive `match` the compiler enforces, the sole accessor to a private field, a sealed schema.
  Reasoning that merely accumulates members is not a bound.
- A set assembled from prior reports, a subagent's findings, or recollection is `ASSUMED` no
  matter how many of its members are individually cited. **Individually verified members never
  upgrade the set.**

When a pass reports a member missing, the answer is the bound, not the member. Appending the
finding leaves the set `ASSUMED` and puts the claim out of proof again for a reviewer who can find
the next absence but never the last one — one memo spent five consecutive rounds that way while its
decisions had stopped moving. Replace the list with the predicate and the command that enumerates
it (on the tetel route, a `run` the claim's fact witnesses), or narrow the claim to what the sweep
returned and say so.

This is the prose counterpart of the coverage-claim rule (an invariant claiming totality needs an
enforcer or escape probe), and the artifact-level form of delivery §D's "fix the class, not the
finding."

Let layout follow section shape. Where one conclusion rests on several facts — soundness, class
analysis — lead with the `VERIFIED` facts as standalone lines and derive below them: the fact
base becomes auditable as a set, and every premise gets an address to cite. For local,
spec-style prose, an inline tag beside each claim serves the same discipline. Both layouts are
sound; forcing one onto a section shaped for the other is not.

A claim is *load-bearing* if the design changes when it is false. Apply the test literally: write
the negation, and ask whether you would still ship this design. If yes, it is decoration and does
not need a tag. If no, it needs `VERIFIED`, `ARGUED` with its premises named, or a falsifying test.

When a whole passage is decoration — motivation, background, history — fence it once ("this
subsection is motivation, not load-bearing") instead of tagging sentence by sentence. The fence
is itself a claim — apply the same test: if anything inside would change the design were it false,
move it out and tag it.

### A load-bearing unknown is an open task, not a disclosure

Writing "UNKNOWN, must be resolved before implementing" on a claim the design rests on does **not**
make the doc ready. It makes the doc unfinished, in writing. The doc is not ready to close until
every load-bearing claim is `VERIFIED` or `ARGUED` from verified facts.

This is the tagging system's own failure mode, so watch for it specifically: **a stated unknown
looks like diligence.** It reads as "I checked, and this is genuinely open" while often meaning "I
stopped reading." The honest label supplies the feeling of rigour without the rigour, and it
survives review, because a reviewer will not challenge something you have already flagged.

Before flagging anything UNKNOWN, ask: *could I resolve this by opening one more file — or, for a
claim about an external system, by opening its installed source or fetching its primary
documentation?* If yes, that is not an
unknown — that is the next thing to read; for the external-system case delivery §A owns the
evidence rule, and a platform guarantee or a third-party behaviour is settled against its primary
documentation, not parked under a label. Reserve UNKNOWN for what has nothing left to open — a
production workload characteristic, or an external-system claim whose documentation you tried and
could not fetch — and say which it is.

Expect resolving them to change the design, not merely to confirm it. When a real instance of this
was chased down, the "unknown" turned out to hide a third code path whose failure mode was worse
than the defect the doc was written to fix.

The most dangerous claims are the ones that feel too obvious to check — visibility modifiers,
call-site counts, "there are no other callers," "this is already private," "that path is
unreachable." These are exactly the claims that are cheap to verify and expensive to get wrong.

## Substitution vocabulary

Certain phrases are where evidence gets quietly replaced by assertion. When you write one, stop
and re-derive the claim from opened source:

> by construction · structurally · trivially · cannot · compile error · deliberately · obviously ·
> is already · there are no other · unreachable · guaranteed · never · fail-closed · exhaustive ·
> read-only

None of these words are forbidden. Each is a flag that the sentence containing it is doing work
that evidence should be doing. Before shipping, grep your own draft for them and check each hit.

## Match each claim to its cheapest falsifier

Before drafting, sort the load-bearing claims by the cheapest artifact that could prove them
wrong, and work in that medium — never substitute a cheaper one:

- **An execution** — claims about mechanism behaviour: what code does on given inputs, including
  inputs from states that do not exist yet. Spike or build first; prose may *record* a mechanism
  an execution has pinned, never assert one in advance. If nothing shipped can build the fixture,
  the claim is execution-owed, not arguable. Once the code exists, record a pinned mechanism as a
  pointer — the symbol and the test that pins it — not a paraphrase of its behaviour: a paraphrase
  is graded once and the code it describes keeps changing, and nothing re-grades it. Reserve the
  doc's evidence for what reading the code cannot recover — the constraint that forced the shape,
  the alternative rejected, the observation that settled it.
- **A constructed attack** — claims about what an adversary can do against a specified interface.
  Prose design plus adversarial review is the right instrument.
- **Neither** — forward contracts and format ratchets, rules for readers that do not exist yet.
  Decide the observable in prose at contract depth, and stop before mechanism.

Revising un-executed mechanism prose under review does not converge: each rewrite mints new
execution-only-falsifiable claims about as fast as review retires them. The exit is to stop
generating mechanism prose, not to stop reviewing — review of contracts and adversarial surface
stays productive. "The failure modes resist testing" (criteria above) is this rule's boundary
case, not a conflict: it covers claims whose deterministic falsifier does not exist, where prose
review is the best remaining instrument and a can't-build entry records why. This section asks
for the cheapest falsifier that *exists*.

## Spike the load-bearing claims

You cannot know at design time how a test will behave. So do not design it — **write it.**

Collect the execution-class claims the design rests on into a spike list and run them *before*
finalizing the doc,
even if the fix does not exist yet. A test that fails today for the reason you predicted converts
the red half of your central claim from `ARGUED` to `VERIFIED` — the green half stays owed until
the fix exists (see the pairing rule below). A test that fails for a *different* reason has
just saved the design.

Both outcomes are worth the cost, and the second is the valuable one. Expect the spike to change
the doc — a fixture that cannot be built as prescribed is telling you something the prose could
not.

## Pair every invariant with a falsifying test

No clause ships without a test that goes **red when its code is reverted**. State the mutation
explicitly in the doc: *revert X → this test fails.* If you cannot name the mutation, the test is
not pinning the clause.

Naming the mutation is not demonstrating it. Demonstration — red under the mutation, green under
the fix, each by a run — is owed when the code exists; delivery §D gates both directions at merge.
At design time only spiked claims have runs: record those. For the rest, the doc's obligation is
the observable and the revert, not the ledger.

Watch for observables that are **printed, not asserted**. A test pins only what its assertions
compare; anything it merely prints is a log line the test keeps passing without. When the doc
cites a specific observable from a run — an exit code, a count, a message, a field — that
observable must be an assertion in the test, at the strength the citation leans on it (a claim
that "the collector swept" needs `deleted > 0`, not the transcript's exact count), before the doc
may cite it. A pasted transcript records what happened once and goes stale silently when the
behaviour changes. This holds even when the observable is current-defect behaviour: assert the
defect and mark that assertion as the one that inverts with the fix — that is what turns "this is
live today" from a diary entry into a tripwire.

Watch for tests that pin a *proxy* rather than the claim: a unit test that exercises a primitive
with arguments shaped like what a call site would pass does **not** pin the call site's wiring.
If a site's wiring is load-bearing, it needs a site-level test. Site-level is necessary but not
sufficient: a fixture whose injected value coincides with a rival constant is still a proxy — see
delivery §D's distinguishing-fixture rule.

Watch for tests that would be **flaky in both directions**. A test that sometimes passes on
reverted code is not a weak detector — it is a false one, and worse than a documented gap.
Process-global state — caches, warm fixtures, memoized reads — is where "sometimes" hides:
demonstrate the red under the state the claim actually covers, not just the state the test happens
to construct.

Watch for **coverage claims backed by samples**. When an invariant claims totality over a domain
— "every call site," "no input escapes," "fails closed" — bidirectional falsifiers cannot
establish it: the mutation author and the check author share one model of the domain, so sampled
mutations only probe points that model can see, and an input the check silently never observes
stays green under every mutation you will think to write. Name the **enforcer** that makes the
*checked* domain equal the *claimed* domain — a compiler guarantee (cite the mechanism), an
enumeration-totality assertion (cite the assert), or an exhaustive match with no default-pass arm
— and confirm the enforcer is independent of the observation it certifies: a totality equation
whose two sides are computed from the same partial parse balances exactly when the parse is
wrong. Failing an enforcer, commit an **escape probe** — a test feeding the check an input from
outside its visible domain and asserting it goes red rather than silently green. With neither,
the invariant is a spot check: narrow the written claim to the cases actually checked (see
"Downgrade claims that outran their evidence").

## Honest gaps beat invented coverage

When a claim genuinely cannot be pinned by a deterministic test, write a **can't-build entry**:

1. The mechanism — precisely why no deterministic falsifier exists
2. What was tried, and what it would take to make it buildable
3. The residual risk if the claim is wrong
4. The triggers that would make it buildable later, so the entry gets revisited

A can't-build entry is a legitimate outcome. Silence is not. The difference between an honest gap
and a cop-out is whether the mechanism is written down at a level a reader could refute.

Never close a testability gap by adding a fault hook, env-var backdoor, or `#[cfg(test)]` escape
hatch to production code — least of all to the primitive under discussion. If a test seems to
require one, that is a finding about the design, not a licence.

## Downgrade claims that outran their evidence

When a claim cannot be tested but *can* be checked by reading, say so in those terms — a
structural claim verified by reading two locations is legitimate, and is not a softer synonym for
"untested." State what makes it structural, and name the condition under which it stops holding.

Narrow-and-checkable beats broad-and-argued, every time.

## Preconditions and warrants

If a claim holds only under a precondition, state the precondition **on the claim**, not in a
footnote. Then check that the warrant you cite is actually in scope: an argument that borrows
justification from a mechanism which is not active at the point being justified is a real defect,
even when the conclusion happens to be true.

Where a precondition has a known future breaker, tie it to a tracking issue in the doc so both get
revisited together.

## Shape of the doc

Numbered sections, roughly: defect · fix · soundness (with preconditions) · class analysis ·
spike ledger · falsifying tests · rejected alternatives · risks/open notes · when settled.

- **Class analysis is not optional.** Fix the class, not the finding: enumerate every call site,
  report per-site status, and say plainly when a site is *correct as written* rather than
  fixing it for symmetry.
- **The spike ledger is a section of the doc, not a check to remember.** One row per load-bearing
  execution-class claim: the claim, and its disposition — **run** (result, this session),
  **implementation-owned** (named catcher; legal only where falsity would change mechanism, not a
  decision — the deferral test), or **can't-build** (entry per above). A doc with no ledger is
  claiming its execution class is empty; that is an enumeration claim — state it as one line and
  expect review to attack it. The asymmetry is the point: an absent or thin section is visible to a
  reviewer, an unperformed check is not. Numeric constants that budgets, thresholds, or limits are
  derived from are execution-class unless their citation says otherwise.
- **Version by layering**, newest changelog paragraph on top, older ones preserved. Record
  corrections as corrections — when a prior version's reasoning was wrong, say what was wrong and
  why it survived, rather than silently editing the prose.
- No transient process labels ("stage 3", "round 4") in technical prose; version markers belong in
  the header.

## Two traps that generalize

Repository-specific conventions belong in that repo's `CLAUDE.md`, not here. These two recur
across projects:

- **Two-halved state.** Where state has a durable representation and an in-memory one (a flag on
  disk plus a cache, a DB row plus a live handle), any claim about clearing, setting, or scoping it
  must address **both halves**. Verifying one and stopping is a documented failure of this exact
  discipline.
- **Private docs, public code.** Never cite a private or non-shipping document from source that
  ships publicly — it is a pointer the reader cannot resolve. Make code comments self-contained and
  anchor them to a document that ships alongside the code.

## When the design phase ends

The design phase ends when a review round yields zero decision-changing findings. Per finding, ask:
*what is the cheapest downstream instrument that would catch this?* When every answer is the
compiler, a named test, or code review of the implementation diff, the doc is done — those findings
are real, and they route to the instruments that own them (delivery §B owns the routing), not back
into prose. **Ending the design phase does not predict a light code review.** Mechanism defects
surface at the implementation gates *by design* — moving a defect from prose to a diff is what makes
it real and fixable, not what makes it free. Budget the code-review rounds accordingly; their yield
is the system working, not the stopping rule failing.

## When it is ready

Check before closing it:

- **If an advisor mode is active, the advisor has attacked the finished doc**, and every finding it
  marked as changing what gets built is resolved. The main session authors the design — the
  recommendation, alternatives and invariants — and the advisor's role is the adversarial read, not
  authorship. Check the consult skill for the exact contract rather than reconstructing it from
  memory.
- Every load-bearing claim is `VERIFIED` or `ARGUED` with its premises named — **no load-bearing
  `UNKNOWN` or `ASSUMED` survives.** Any that remain are non-load-bearing and say so explicitly,
  singly or behind a passage-level fence.
- Every cited `file:line` was opened this session, at that line — against the current target
  branch, re-grounded if the branch moved while the doc was in flight (a citation into a superseded
  base is stale even though you opened it).
- Every load-bearing execution-class claim is settled by a run this session (recorded in the spike
  ledger) — a spike or an existing
  test, on the substrate the claim names (delivery §A's substrate rule governs), result recorded —
  or explicitly implementation-owned with one line naming the instrument that will catch it (the
  compiler, a named test, code review of the diff), or has a can't-build entry giving the mechanism.
  **Deferral test:** a claim whose falsity would change a decision in this doc may not be deferred —
  spike it or verify it; only a claim whose falsity would change mechanism may be
  implementation-owned. An implementation-owned entry is a deferred obligation with a named catcher,
  not a load-bearing claim of the doc. Every invariant gets one line at contract depth — the
  observable, and the revert that must red it; demonstration in both directions is owed at code time
  and is delivery §D's merge gate, not this one. Every invariant claiming coverage of a domain
  additionally names its enforcer or escape probe, or has been narrowed to the cases actually
  checked.
- Every run observable the doc cites is pinned by an assertion in the cited test, at the strength
  the prose uses it. Sweep the cited spike for printed-only output — `println!`, log lines, pasted
  transcripts — and check each printed value the doc leans on against the test's assertions:
  promote it to an assertion, or downgrade the citation to a one-time, unpinned observation.
- The class analysis enumerates call sites with a per-site verdict, including the ones correct as
  written.

Then report the close according to the path you were on. **Under tetel**, report the memo path, the
`check` verdict and the surviving qualifications, and say the design phase is closed; do not queue a
`/code-review` round on the doc. **Without tetel**, report the `/code-review` rounds you ran and what
each changed.

A closed design is ready to implement. The end of a design is a phase boundary — `powerup`'s
phase-boundary rule owns whether to hand off there. Never begin implementation before the close: the doc's job is to be wrong cheaply,
before the code makes it expensive.
