---
description: Design-doc mode — a standing session rule (not "write one now"): from now on, high-consequence changes get a design doc before code, and every design doc holds each load-bearing claim to verified source, a falsifying test, or an explicit unverified tag. User-invoked only.
disable-model-invocation: true
---

# Design-doc mode

**When this skill is enabled, open your response by telling the user, in 1–2 sentences:**
Design-doc mode is on — for design-first work (durability, concurrency, shared primitives, new
invariants) I'll write a grounded design doc first, every claim cited to source, and stop for your
review before implementing.

Enabling this skill sets a rule for the rest of the session; it is **not** a request to write a
design doc right now. From now on: a change in the design-first class (next section) gets a design
doc *before* the code, and every design doc you write follows the method below.

When you do write one, flag it ready-for-review and **stop** — the user launches the review, which
is `/code-review` run on the doc. Hand over the full paste-ready command with it, every time you
suggest a round including repeat suggestions; `delivery` §B owns what that command must carry.

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
cite. Not "I recall that function," not "the other memo says," not "the executor reported."
Line numbers drift; files get split; a citation into a file shorter than the line number you
wrote is a real thing that has happened.

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
make the doc ready. It makes the doc unfinished, in writing. The doc is not ready for review until
every load-bearing claim is `VERIFIED` or `ARGUED` from verified facts.

This is the tagging system's own failure mode, so watch for it specifically: **a stated unknown
looks like diligence.** It reads as "I checked, and this is genuinely open" while often meaning "I
stopped reading." The honest label supplies the feeling of rigour without the rigour, and it
survives review, because a reviewer will not challenge something you have already flagged.

Before flagging anything UNKNOWN, ask: *could I resolve this by opening one more file?* If yes, that
is not an unknown — that is the next thing to read. Reserve the label for what genuinely cannot be
determined from the code in front of you (a platform guarantee, a third-party behaviour, a
production workload characteristic), and say which of those it is.

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
  an execution has pinned, never assert one in advance. Name the fixture and the shipped surface
  that constructs it; if nothing shipped can build the fixture, the claim is execution-owed, not
  arguable.
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

## Spike the load-bearing claim

You cannot know at design time how a test will behave. So do not design it — **write it.**

Pick the single claim the whole design rests on and build its test *before* finalizing the doc,
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

Naming the mutation is not demonstrating it. A falsifier is established in **both directions**:
observed red under the named mutation, observed green under the fix — each by a run, never by
assertion. A test red in both worlds pins nothing — it can never show the fix worked, and a
terminal `.expect()` sitting before the real assertion is enough to cause this. A test green in
both worlds pins nothing — the mutation survives. "Red today, for the predicted reason" establishes
only the red half; both halves of this failure have passed review while satisfying it. When the fix
does not yet exist, green cannot be run: say which direction has been demonstrated and which is
still owed — the owed green run lands with the fix, and the clause is not pinned until it does.

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
If a site's wiring is load-bearing, it needs a site-level test.

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
falsifying tests · rejected alternatives · risks/open notes · when settled.

- **Class analysis is not optional.** Fix the class, not the finding: enumerate every call site,
  report per-site status, and say plainly when a site is *correct as written* rather than
  fixing it for symmetry.
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

## When it is ready

Check before flagging it:

- **If an advisor mode is active, the advisor authored the design substance and has seen the
  finished doc.** In that mode the division of labour is not optional and not a question of how
  confident you feel: the advisor authors the recommendation, alternatives and invariants; you
  ground every claim in `file:line`, transcribe, and feed discrepancies back. Doing the verification
  yourself is the scribe's job done well — it does not make you the author. Check the consult skill
  for the exact contract rather than reconstructing it from memory.
- Every load-bearing claim is `VERIFIED` or `ARGUED` with its premises named — **no load-bearing
  `UNKNOWN` or `ASSUMED` survives.** Any that remain are non-load-bearing and say so explicitly,
  singly or behind a passage-level fence.
- Every cited `file:line` was opened this session, at that line — against the current target
  branch, re-grounded if the branch moved while the doc was in flight (a citation into a superseded
  base is stale even though you opened it).
- Every invariant names the mutation that reddens its test and records which directions — red under
  the mutation, green under the fix — have been demonstrated by a run and which are still owed, or
  has a can't-build entry giving the mechanism. Every invariant claiming coverage of a domain
  additionally names its enforcer or escape probe, or has been narrowed to the cases actually
  checked.
- Every run observable the doc cites is pinned by an assertion in the cited test, at the strength
  the prose uses it. Sweep the cited spike for printed-only output — `println!`, log lines, pasted
  transcripts — and check each printed value the doc leans on against the test's assertions:
  promote it to an assertion, or downgrade the citation to a one-time, unpinned observation.
- The class analysis enumerates call sites with a per-site verdict, including the ones correct as
  written.

Then flag it ready-for-review and stop — the user launches `/code-review` on the doc, so end with
the paste-ready command per `delivery` §B. Do not begin implementation. The doc's job is to be wrong
cheaply, before the code makes it expensive.
