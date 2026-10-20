---
description: Delivery mode — mode-independent doctrines for shipping work in any session: grounding handed-down findings, code-review routing and tiers, one-finding-one-PR shipping cadence, and fix-the-class execution discipline. User-invoked only.
disable-model-invocation: true
---

# Delivery mode

**When this skill is enabled, open your response by telling the user, in 1–2 sentences:**
Delivery is on — I'll ground handed-down findings — and my own checkable claims — before acting on
or durably writing them,
route pre-merge review through
`/code-review` (after CI is green where a PR with checks exists; **run on my own authority,
capped at medium**), ship one finding per PR, and
fix the class with run-and-reported revert-checks.

Scope: this skill holds the doctrines that apply to shipping work regardless of which other mode
is active — with or without an advisor, with or without a design doc in
flight. It is not a junk drawer: a doctrine with a mode-specific home lives there instead of here
— design-first class criteria belong to design-doc, and advisor mechanics belong to consult.
This skill only owns what has no other home.

## A. Evidence rules

Treat every handed-down finding as unverified until you check it against current code — a Jira
ticket, a prior-session summary, a subagent's report, a review finding, a memory file. All of
these describe a past state of the code or a past act of reading it; none of them are the code
itself. The memory system already stamps its own reads with exactly this warning — extend that
caution to every other secondhand claim.

**Your own freshly authored claims get the same treatment.** A claim does not need to be handed
down to be unverified — the sentence you wrote two minutes ago about current code, a tool, or an
environment ("every call site goes through X," "the formatter keeps chains on one line," "no status
yet means the run finished") describes your model of the code, not the code. The trigger is
observable, not a feeling: you are about to **act on** a load-bearing factual claim — load-bearing
meaning the next step changes if it is false — that a single grep, file-open, or five-line run
could settle, and you have not run that check this session. Run it first; the check costs seconds,
and the argument it replaces costs a rebuild when it collapses. Argument length is the secondary
tell: when your justification for why something works keeps growing, some sentence in it is a
checkable fact doing work a file could do — open the file instead of extending the argument.
(Design-doc's "cite nothing you have not opened this session" is this same rule confined to doc
authoring; this paragraph is its session-wide form, for claims that never enter a design doc.) For
enumeration claims specifically — "these are all the callers/writers/surfaces" — design-doc's
bound-not-members rule applies even when the claim never enters a doc: a set is only as verified
as the sweep or closing mechanism that bounds it, and individually verified members never upgrade
the set.

**Writing a claim into durable prose is acting on it — the actor is the future reader.** An
explanatory comment, a guide sentence, a commit message: your own next step does not change if the
aside is false, so the trigger above never fires — and review does not fire either, because a claim
about *why* something is safe survives review exactly when the surrounding conclusion happens to be
true (reviewers argue with the reasoning instead of opening the file). So a checkable mechanism
claim headed for durable prose gets one of two moves before it ships: open the file, or narrow the
claim to what you can support without opening anything. Prefer narrowing — "nothing in this command
writes before the probe" names the property doing the work and cannot rot; "this read-only command"
was false the day it was written. The tell-words are design-doc's substitution vocabulary
("cannot", "never", "unreachable", "read-only", …); sweep prose you are about to ship for them the
way that section sweeps a doc draft. Plain narration needs neither move — the claim that earns one
is the one a reader would take as a reason.

**Before a claim gets either move, ask whether it should be prose at all.** This sorts the prose the
paragraph above names — comments, guide sentences, commit messages; a design doc's claims are
graded, and design-doc owns them. Sort by what only the sentence can carry:

- *Derivable from the lines it sits beside* — what the code does, restated — carries nothing: the
  reader has a better falsifier one line down. Cut it. Cut only what *agrees* with the code; a
  restatement that disagrees is a finding to resolve first, since the code may be the bug (§D, never
  sync docs to defective code).
- *An obligation on a future editor* is not a claim and gets neither move — there is nothing to
  open. §D's obligation bullet owns it: it becomes a mechanism, never a comment.
- *A fact about an artifact elsewhere that moves* — a grant in another repo, a stack list, a
  deployed policy, a tool's exit behaviour — is never cut: stated, it can be refuted; unstated, it
  cannot. Prefer a check that reads that artifact and goes red when it moves (§D's enforcer bullet
  names the forms). Where no check can be built, the sentence ships with the location and the
  command that re-derives it, so the next reader re-runs rather than trusts — and is narrowed per
  the paragraph above.
- *Why this shape and not the other* — the constraint that forced it, the alternative rejected, the
  observation that settled it — is kept. Code shows only what won.

**Locate the falsifier before you argue.** A load-bearing claim about behaviour — a default you did
not pass, what a call returns or throws, what runs before what, what a deployed thing permits — is
settled in whichever of three places holds the thing that could refute it, and choosing the wrong
place looks like diligence:

- **In the worktree, including installed and vendored dependencies.** `node_modules/`, `vendor/`, a
  bundled `dist/` are source on disk, pinned by the lockfile. For a claim about what a library does,
  that source outranks its documentation, which omits the defaults and error paths the code states
  plainly. The tell: your sentence is about the *callee* — what it defaults, returns, throws, or
  does first — and you have opened only the caller. Open the callee; cite its path and the version
  the lockfile pins.
- **Outside the worktree.** Apply the worktree test: would the claim's truth be identical on a fresh
  clone with no network and no credentials? If not — a deployed role's statements, a running
  service's configuration, an account's state — nothing that reads the tree can settle it: not
  tests, not synth, not review, and not merge. *Merged* is a claim about the tree. A change whose
  effect lands in an account is not in force until an artifact read back from that account says so;
  expect "not deployed" by default, record the deploy as an owed action with its owner, and give the
  completion record one entry per substrate the change lands on, so an undeployed grant is an empty
  cell rather than a silence. When you do read the estate, put the identity in the command — a
  profile, an endpoint, a URL — never through ambient configuration, and name it again beside the
  result: the ambient identity is precisely the case where you do not know it is the wrong one.
  (Design-doc's out-of-worktree rule is this test applied to refutations; this is its session-wide
  form.)
- **In neither** — a remote platform's guarantee, a service version's documented limit, code you
  cannot obtain. Then, and only then, the settling check is the system's primary documentation,
  cited where the claim lives; where it cannot be fetched, the claim ships marked unverified rather
  than bare.

Gate local experiments by substrate before they count as verification: an experiment establishes
such a claim only when run on the implementation, version, and configuration the claim names; on
anything else it corroborates the mechanism at best, and a *passing* run on the wrong substrate is
the dangerous case — it launders an unverified claim into a "tested" one. Name the substrate beside
every result, not only when you believe it differs.

Verification sometimes shows the finding was wrong — a cited function no longer exists, a line
number has drifted, a described behavior doesn't reproduce. That outcome is a first-class
**success**, not a failed task: "not reproduced, here's the evidence, here's the narrower real gap"
is exactly what grounding is for. Record refuted findings as refuted — don't quietly drop them or
silently reinterpret them into something that does reproduce.

**Current means the latest base, not the one you happen to hold.** Before you ground a task, a
design doc, or an implementation, fetch the branch the work will merge into and ground against its
tip — fetching is enough; grounding needs the fresh tip, not a rebase of anyone's branch. Work
grounded on a stale base can be invalidated wholesale when the branch has moved: a cited line
drifted, the path was refactored, the very defect was already fixed. Where there is no remote to
sync from, local *is* latest and this is a no-op; where a fetch fails, say so and proceed on the
base you hold rather than blocking. And if the target branch moves while you work — a long design
especially — re-ground against the new tip before you finalize; a citation opened against a
superseded base is stale even though you opened it.

## B. Review routing and tiers

`/code-review` is the standard pre-merge gate. This skill is the only place its usage policy is
documented — routing decisions elsewhere should cite this section, not restate it.

- **Where a PR is viable, let CI go green before the review gate.** When the change ships as a PR — a
  remote forge is in play, not a local-only repo — and the project has checks that run on the PR,
  open the PR and let the automated checks pass *before* you run the `/code-review` merge gate. A red
  pipeline surfaces mechanical breakage (build, lint, failing tests) far more cheaply than a reviewer
  would; reviewing a diff CI would reject spends the expensive gate on findings the cheap one already
  owns. This **orders** the gates, it does not merge them — green CI is necessary, never sufficient,
  and never substitutes for the review. Skip the wait when there is no forge or no CI, and don't
  grind on a stuck or flaky pipeline: if CI can't go green for reasons unrelated to the diff, say so
  and proceed to review rather than blocking. Design-doc reviews are exempt — they run inside the
  design loop (see the design-doc bullet below) and gate the doc's content, which CI does not check.
  Wait for it with `~/.claude/bin/wait-pr-ci <PR>` run in the background — never a hand-written
  loop; read its exit status, never a piped summary of it. A wrapper preserves the status of what
  it wraps: no `| tail`/`| head`/`| grep` on a command whose exit status is the verdict — read the
  status first, trim afterwards.
- **One reviewer per change, resumed across rounds.** Invoke `/code-review` **once**; drive later
  rounds by `SendMessage` to that instance. Verified: a completed review agent resumes with its diff,
  its mutation runs and its findings intact. A repeat `Skill` call always starts a new one. **A
  reviewer's cache lasts five minutes** (the subagent default; a forked `/code-review` takes no
  per-agent TTL). A resume within that window re-reads at 0.1x; a later one rebuilds the reviewer's
  whole context at 1.25x. Read the gap from the reviewer's transcript timestamp rather than
  estimating it. Resume a small reviewer regardless. For a large one,
  compare the rebuild (about 1.25x its context) against a fresh `/code-review` carrying the full block
  above. Measured at ~100k, the two cost about the same, so resume unless the reviewer has grown well
  past that.
- **Later rounds scope *effort*, never permission.** Say what changed and ask it to judge the fixes
  and what they broke; never re-post the diff it already holds. Do not hand it your fix description
  as settled — that is the scoped review this section warns against two bullets down, wearing your
  own words. A resumed reviewer may also anchor on a verdict it already gave, so **name the changed
  regions explicitly** rather than trusting it to re-derive them.
- **Rounds end on the finding class, not on a count.** Keep going while any finding affects the
  *semantics* of the code; stop when a round returns none. Wording, naming and a comment that
  overstates are recorded and fixed, and buy no further round.
- **Run the review on your own authority. Medium is the cap, not the default.** Launching the
  pre-merge review is routine and wanted — do not gate it on the user, do not offer it, just run it.
  What is capped is the *tier*: **medium is the ceiling** for any review you launch yourself. Drop to
  **low** only for changes that are genuinely simple and small — a rename, a localized fix,
  boilerplate.
- **Never launch above medium on your own authority, and do not offer to.** high/ultra costs several
  times medium and, measured across a long session, returns the same defect classes. If the user
  names a higher tier, run what they name; if asked to recommend one, recommend medium and say what
  you would scope it to; otherwise the ceiling holds without discussion.
- **The cap erodes silently, so watch for the rationalization rather than the rule.** This drifts
  the same way every prose rule in this file drifts — not by being disagreed with but by each
  individual case feeling like the exception. The tells are specific and they all sound like
  diligence: the material is subtle, it is authorization or a failure path, the last round found
  something serious, the diff is large, a fix round touched a shared primitive. **None of those is a
  reason to exceed the cap** — they are reasons to scope the review tightly, name the risk in the
  args, and run it at medium. A review at medium that is pointed at the right surface beats a high
  review pointed at everything.
- **If medium genuinely is not enough, the tier is the wrong lever.** Pressure for a bigger review is
  usually the symptom of a skipped design review, an unscoped diff, or work that should have been
  sliced smaller. Ask which of those it is. Raising the tier buys a more thorough pass over the same
  material; splitting the change or writing the design doc changes the material.
- **Design docs are never `/code-review`-ed by the pre-merge gate and never by the user.**
  `design-doc` owns which path reviews a doc and when it closes; where that path is `/code-review`
  (no tetel), you launch it yourself under the cap above.
- **Every review you suggest or hand off ships with its command — every time, including repeats.**
  This holds whether you raised the review or the user asked for it, and **whether or not you gave
  the same command in an earlier turn**. Never write "the command from before", "as above", or a
  bare "run a review round" — restate the full invocation. The user is usually several turns and a
  scroll-back away from the last one, the path or scope has often moved since, and friction here
  does not produce a question, it produces a review that is skipped or run against the wrong thing.
  Always use the **absolute** path: a repo-relative path is not enough, because design memos often
  live outside the working repo, and a review invoked there has no diff to anchor on — it falls back
  to the branch diff and silently reviews the wrong artifact, which reads as a completed review of
  the thing you asked about.
- **The command carries its context inside the copyable block — not just a path, and not in the
  prose around it.** Only what is copied travels: the reviewer receives the block and nothing
  else, so a message can satisfy every content item below and still hand off a bare-path review
  if the material sits in adjacent paragraphs. Do not assume the reviewer inherits your
  conversation: it may run in a separate context entirely, and even when it forks the session,
  that context may have been **compacted** down to a summary. Put inside the block, when each
  applies: which round this is and what prior rounds found; the base commit; the scope, naming
  what to skip **and why**; which parts are new or unreviewed since the last round; conventions
  that would otherwise read as defects (a corrections log describing deliberately superseded
  positions, a section declared the single source of truth); known gaps you do not want
  re-reported; the **depth being reviewed — contract or implementation — so mechanism findings
  against a contract-depth doc read as routing, not as misses; a depth names where the budget goes,
  never a level that is settled (the scoping bullet owns this)**; and the **effort tier, named
  explicitly even when it is the default**, so the
  review never silently runs at a tier nobody chose. A tier written into the block is a
  recommendation the user edits at launch, not a launch — naming an above-medium tier there
  still requires the evidence-shaped case and stated cost from the bullets above. Before
  sending, read the block alone, as the reviewer will receive it: anything a stranger could not
  answer from the block is not in the handoff.
- **Findings route by class; none are suppressed.** Every finding from a design-doc round is
  reported. Then: a finding that changes a decision reopens the doc — revise and re-review; a
  mechanism-level finding goes onto the implementation checklist, where the instrument that owns it
  (the compiler, a named test, code review of the implementation diff — the §D merge gates) will
  catch it. Design-doc owns when the design phase ends; this bullet owns only where each finding
  goes. Routing happens after reporting, never by telling the reviewer where not to look — the
  scoping rule below is unchanged.
- **Scoping narrows effort, never permission.** An instruction may tell a reviewer where to spend
  its budget; it must never tell it to stay silent about a defect it finds anyway. "Don't re-verify
  the citations" is legitimate; anything that would suppress reporting a real problem is not — that
  turns a scoped review into a review that looks clean because it was told to. **Declaring a level
  settled is this failure wearing scoping's clothes** — "the design is settled," "contract questions
  are out of scope," a design doc handed over as the authority the diff answers to. None of these
  reads as a silence instruction, but a reviewer never finds a defect *anyway* at a depth it was told
  is decided: attention follows scope, so the finding class dies without anyone being told to stay
  quiet. A handoff names the depth the review targets; it never names a depth as closed. Where a
  design doc exists, either withhold it — making the review an independent derivation of the contract
  — or supply it with its decisions explicitly challengeable; never as authority. Listing known
  findings as already-reported and deliberate conventions as deliberate stays legitimate — deliberate
  means "not an accident," never "beyond challenge."
- **Say which bets your scoping makes.** Excluding a section is a judgement the user should get to
  overrule, so name what a skipped area could hide and what it would cost to include it. A scope
  the user cannot see is one they cannot correct.
- **Report tier choices like spawn costs.** State which tier you ran and why, the same way
  the user is tracking review spend the
  same way they track model spend.

## C. Shipping cadence

One finding, one PR: each review finding gets its own PR, reviewed and merged before the next one
starts — never a batch.

- Findings **on** the work in progress get fixed before merge, folded into the same PR. Genuinely
  separate, new-class findings get filed as tickets, lazily — only once independently confirmed,
  not pre-filed on suspicion — so the PR doesn't scope-creep and the finding doesn't get lost.
- **Entanglement check before parallelizing.** Two findings or tasks that touch the same primitive
  must run sequentially, never in parallel — splitting them without checking recreates the exact
  interaction the split was meant to prevent.
- **Diff-size conscience.** A diff too large for a reviewer to hold at once is what turns each fix
  into the next finding — this is how a batch of "closed" findings becomes three more rounds of
  live ones. When review rounds **escalate** instead of converging (each round finding something
  worse than the last), that is the signal to stop patching and discard the branch, rebuilding
  contract-first in slices instead.

## D. Fix execution

Fix the class, not the finding. A finding names one call site, but the defect usually lives in a
shared primitive with many callers — a fix verified only at the named site passes its own
regression test while the class stays broken.

- **Sweep every caller** of the primitive involved; fix each or explicitly exempt it.
- **Report per-site status**, including the sites that are *correct as written* — that's evidence
  the sweep happened, not padding.
- **Reuse existing helpers** before writing new comparison or guard logic — check for the helper
  that already solves it one file over.
- **Prefer moving the guarantee into the primitive** over special-casing every call site, so future
  callers can't get it wrong — the guarantee, and only the guarantee. What depends on context the
  primitive cannot see (how a failure is presented, what the caller or user is told to do next)
  belongs to the caller; a primitive that guesses it is right for one caller and wrong for the
  rest. Anything a primitive tells its caller to *do* is a claim that must hold on every path that
  can reach it: offer it only where it does, pin it with a test that performs it, and otherwise
  state the fact alone. "This primitive serves caller X" is a caller-enumeration claim and owes the
  sweep above when it is made; a sweep done earlier for a different question does not discharge
  it.
- **An obligation written in prose is a guard that is not there.** "Update this list when you add a
  statement", "a new key belongs on the base set too": writing it down feels like discharging it and
  discharges nothing — the editor it addresses is exactly the one who did not read it. Convert
  before merge: an exact-set assertion, a compile-time shape (`Record<keyof T, …>`), or a test that
  fails on the edit the comment warns about; the test then owes the revert-check below. The sharpest
  tell is an allowlist or coverage mirror entry annotated with why it does not yet qualify — that is
  the guard disarmed in writing, and merging it puts every run past the check it was built to fail.
  A hand-maintained list mirroring a truth held elsewhere is the coverage-claim bullet below with
  its domain written by hand: the mechanism is a check against the artifact it mirrors, never a
  reminder to keep it in sync. If the obligation cannot be mechanised, that is a finding about where
  the invariant lives — the bullet above — not a licence to leave the comment.
- **Revert-check, run and reported — both directions.** No durability or contract clause ships
  without a test demonstrated **green with the fix in place and red when the fix — and only the fix
  — is reverted**. Revert means the mutation of the property the test exists to exclude, not removal
  of the feature: a test red when the whole feature is absent and green when it is present has shown
  that the feature exists — the wrong value origin, the wrong region, the re-seeded field are all
  still green. Name the wrong behaviour, mutate to it, show the red. Both runs must actually be
  **run** and their output reported; never asserted. A
  red-only report — a pinning test committed "red for the predicted reason" — establishes nothing by
  itself: red in both worlds pins as little as green in both. At code time both worlds exist, so
  neither direction may be left owed at merge. (Design-doc names each invariant's observable and
  revert at contract depth; this gate owns the demonstration once the code exists.)
- **A revert-check certifies only what its fixture can distinguish.** The rule above is necessary,
  not sufficient, and reads as more than it delivers: "red when reverted" certifies the claim only
  over the domain the fixture exercises. When the claim is that an observable is **computed from, or
  wired to, a particular source or target** — an instance field, a config value, an environment
  read, an attach target — the pinning test
  must give that source a value which **separates it from every rival the code could have read
  instead**: every constant in scope, every default, every same-typed field. Coincidence is the
  tell. If the injected value equals anything else the code could have used, the right and wrong
  implementations are extensionally equal everywhere the test looks, and it cannot tell them apart
  no matter how convincingly the revert run went red. Where production constructors can only
  produce constant-valued sources, **add a test-only injection point** rather than settling for the
  values production paths happen to permit — one sentinel colliding with nothing kills every
  hardcoding mutant at once, and beats a conspiracy of tests that jointly cover the case by
  accident. Report the separation, so the check cannot be claimed without being done: *injected 7s;
  separates from CONNECT (5s), CONNECT_TOR (60s), BODY_READ (10s); collisions: none.* This is the
  coverage-claim rule below, specialized: a fixture exercising one client is a checked domain
  strictly smaller than the claimed domain of every client, with nothing making them equal. Do not
  expect a mutation-testing CI lane to cover this — source substitution is not an operator such
  tools generate.
- **A green reachable without the property certifies nothing.** Beside coincident values (above),
  three more ways a test's green does not depend on what it is named for: a **fake that answers what
  the real dependency could not** for the request the code actually sent — a region-blind stub, a
  stand-in that skips the guard under test — so the test measures the fake's generosity; an
  **assertion the empty case satisfies** — "touched neither X nor Y" over a set that iterated
  nothing, "still empty" where the wrong path also writes empty; and an **expected value derived
  from the implementation itself** — a message checked against the constant it was formatted from,
  a shape checked against a sibling built by the same helper — so any wording or shape passes,
  including the wrong one that shipped. Give the fake exactly the refusals the real thing has; pair
  every negative with the positive that shows the domain was non-empty and the guard engaged; assert
  against a source independent of the code under test — a literal, the documented contract, or a
  property the output must satisfy. The one question for all four: what would have to change for
  this test to go red, and is it the property?
- **A red run certifies the assertion that produced it — name it.** "The file went red" attributes
  nothing: with neighbours in the test, any of them can supply the red while the shipped assertion
  asserts nothing at all — the incident seeding this bullet shipped `not.toBe` on an array,
  identity-true forever, and the revert run's red came from the line above it. The runner's failure
  output already names the failing assertion and the value it saw; report both, the way the fixture
  bullet reports its separation. When that output names anything other than the assertion being
  certified, nothing has been certified yet: silence the neighbours for one run and show the shipped
  assertion go red alone.
- **A test that claims coverage names its enforcer.** A shipped check asserting "every X
  conforms" or "no X escapes" needs the mechanism that makes its checked domain equal its claimed
  domain — or a committed escape probe from outside its visible domain — or its name and docs
  narrowed to the cases it actually checks. Sampled mutations going red do not establish
  coverage. (This is the code-side twin of design-doc's coverage-claim rule.)
- **Changed contract, changed test.** If a contract's behavior changes, its test changes with it in
  the same PR.
- **Never sync docs to defective code.** "Code wins over docs" is dangerous exactly when the code
  is the bug — reconciling a doc to match buggy behavior documents the defect instead of fixing it.
