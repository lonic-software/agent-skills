---
name: delivery
description: "Explicit delivery mode: verify evidence, review changes, and fix defect classes before authorized delivery."
---

# Delivery mode

On activation, say that delivery is on: check factual claims against current
evidence, run the review gate at no more than medium effort, keep findings
separate, and verify fixes with meaningful negative checks.

This governs delivery; it does not add commit, push, publication, or merge
authority. Consult and design-doc own their own workflows.

## A. Evidence rules

Treat every handed-down finding as unverified until you check it against current code — a Jira
ticket, a prior-session summary, a subagent's report, a review finding, a memory file. All of
these describe a past state of the code or a past act of reading it; none of them are the code
itself. Apply that caution to every secondhand claim, whether or not the client labels it.

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

Codex uses the lonic-reviewer-low and lonic-reviewer-medium custom agents for
this gate. Do not invoke Claude's /code-review command or invent its availability.

- Run the complete affected package suites and dependent-package suites before
  requesting publication. Bound long runs. Name checks that could not run and
  their actual reason. A selected subset is not complete-suite evidence.
- Walk the project's bookkeeping requirements, including changelogs. State
  what changed or that no such list exists.
- Where a PR and CI exist, get CI green before the merge review. A failure
  unrelated to the diff is reported and need not prevent review. Green CI does
  not replace review. Use the project's existing CI watcher when available;
  otherwise use the forge's supported bounded watch command. Preserve its exit
  status and distinguish failed, unknown, and passed checks on the current head.
- Launch the review when authorized work calls for it. Medium is the ceiling
  for self-selected review effort; low is for simple localized changes. Never
  escalate above medium without the user's explicit request. Large or subtle
  diffs call for better scoping or design, not an automatic higher tier.
- Use `collaboration.spawn_agent` with the selected lonic-reviewer agent type
  and `fork_turns: "none"`. Keep one reviewer per change. After completion use
  `collaboration.followup_task` on the same target for each subsequent round.
  Do not claim continuation when the previous agent was unavailable.
- Give the reviewer the absolute repository path, current base commit, complete
  change scope including untracked files, prior findings, changed regions,
  conventions, and actual validation. State the requested effort. A review of
  an implementation must leave the design challengeable, not treat it as settled.
- A copyable review request must contain that context itself, including known
  findings and any excluded scope with its risk and cost. Repeat the complete
  request when offering it again. A bare path or 'same command as before' is
  not a review brief.
- Later rounds focus effort on the delta and what it can break, but never
  prohibit findings elsewhere. Report all findings. Keep going while semantic
  blockers remain; do not fix a round count. Editorial findings are recorded
  and fixed without buying an additional round on their own.
- Design-doc owns the design review loop. Where no tetel is used, its ordinary
  review uses these mechanics. Where tetel is present, its independent grounder
  requirement remains mandatory; this reviewer does not replace it. If the
  required workflow is unavailable, report the blocked gate rather than pass it.
- Report the selected tier and why. Codex cache lifetime and monetary savings
  are not established by the upstream Claude measurements. Do not copy those
  numbers into Codex guarantees or restart a reviewer merely on that basis.

Reviewer instructions forbid source changes. Custom-agent permissions are
inherited; that instruction is not a separate OS read-only boundary. Review
does not authorize a merge, push, or publication that the user has not allowed.

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
