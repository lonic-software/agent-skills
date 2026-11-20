# Design-doc: the tetel grounding loop

Read this file when a design starts and tetel is installed (design-doc's routing). It is part of the
design-doc skill; `SKILL.md` beside it holds the routing, the criteria and the one rule, and
`method.md` holds the method both routes share.

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
which a revision round always outlasts (`rationale.md`). Past the hour, a fresh pass
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
  re-read on every later request and charged roughly **15x** its size; the same bytes late cost ~3x
  (measured: `rationale.md`).
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
cannot reorder, so choose placement as you write. This is not tidiness: a keystone claim that exists
only in prose enters during exactly such a writing phase (`rationale.md`). Read the
block ids from `query prose` immediately before any batch of `prose --revise`; never reconstruct them
from memory or by counting. Ids are permanent but positions are not — an inserted block keeps its own
id wherever it lands (`P35` can sit between `P19` and `P20`), so any count is off by one past the
first insertion, and the row number `query prose` prints is a position, not an id. A revise against
the wrong id silently overwrites whatever block holds it.

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
detached, which makes the loop unable to wait for the result it exists to read, and a designer in
that state polls (`rationale.md`). Never poll for an agent.

**Never run the attacker and a grounder at the same time, and run the attacker first.** Dispatched
detached, they overlap. The order matters on yield: an attack pass and a grounding pass cost about
the same per round, but the attacker provokes several times more revisions per record
(`rationale.md`). Running the high-yield
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
review at its successor re-runs the demonstrated failure (`rationale.md`). Refutations witnessed
from source are contract-level, and this rule stays silent on those.

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
source outcompetes the half without, and the result renders as clean as a complete memo, because
nothing in the artifact distinguishes never-asked from answered (`rationale.md`).
Name the sections a reader would expect the
finished design to contain; anything outside that surface is an explicit deferral in the brief, so a
gap in the memo is a stated deferral rather than a silence. And a decision no source can settle — a
stack, a product feature set — is settled with the user before dispatch: the designer has no channel
to ask, so an unaskable question becomes an omission.

**Run an attacker every round, even when the grounding came back clean** — especially then, since a
clean grounding is exactly the state in which nothing else will question the design
(`rationale.md`). A grounder grades **each proposition as written**, so it structurally
cannot see what the claims fail to establish *jointly*. The two are not substitutes.

**A refutation's fix is re-validated by an attacker, not by a grounder.** A grounder grading the
repaired sentence establishes only that the new sentence is true. It cannot see the defect class a
refutation-fix risks — a fix that is right about the finding and wrong about a premise neither the
finding nor the fix made explicit (`rationale.md`).

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
settled, and the difference is expensive (`rationale.md`). If a grounding round comes back dry and no
attacker has seen the current text, **the next pass is an
attacker, not a stop.**

**A caveat is not a close.** "No attack pass has seen the answers" written into a close-out report is
the stop condition failing, in writing — the process-level form of the load-bearing UNKNOWN: the
honest label reads as diligence and survives precisely because it was flagged. If revisions landed
after the last attack pass, the next pass is an attacker, at any `check` verdict and any round count;
if it refutes, the design is reported unfinished, not clean-with-a-caveat. Either way the close-out
report states that the final attack pass read the text being closed.

**And an earlier formulation of this rule — "stop when the last round provoked no revision" — is
unreachable, which is why it is gone.** Any round that answers a finding rewrites some wording, which
invalidates the attacker's grading, which requires another attacker, which finds something:
**every revision writes new prose and new prose carries new overreach**, typically a single clause
saying *only*, *never* or *permanently* about a claim right in substance (`rationale.md`).
Iterating cannot drive that to zero; it manufactures it.

So: refutation and target churn extend the loop, up to the ratchet below. Prose accuracy does not.
Once both attack passes and grounding passes are returning only the second kind, stop — do not run
one more round to be sure (`rationale.md`).

**Make the distinction the attacker's job, not yours.** Ask each attack pass to say, per finding,
whether it changes what gets built or only what the implementer is told. They separate the two
readily; it is the stop decision that needs the separation stated rather than inferred.

### The ratchet

**Every pass goes into the design ledger** (`design-ledger`, beside this file, opened at intake,
SKILL.md's *Slice size*): `pass attack|ground --build yes|no` after each one, with `--build yes`
when the pass returned a finding that changes what gets built (the attacker says which, above), and
`close` when you judge the loop stopped by the rule above. The ledger blocks, and the `tool-gate.sh`
hook enforces the block on the next attacker or grounder spawn and on the next render:
- **three consecutive build-changing attack passes after a close**: the loop is not converging on
  this scope. Rounds stop on no blocker findings, and here the blockers are not running out;
- **four grounding passes**: the expensive instrument is capped. The closing attack pass is never
  blocked by this cap. Machine-clean at the cap with revisions no attacker has seen is not clean; it
  is unattacked text with a green attached;
- **a claim over about 8k characters**, or **a modification target outside the scope recorded at
  open**: the render is refused (SKILL.md's *Slice size*).

**The way through is a recorded decision, and its default is the cut.** `decide --note "<the
decision, who made it>"` records it. Name what the cut drops and what it costs, so the decision is
weighed against a stated price rather than against a vague wish to finish. You and the advisor take
it alone when queue-run's *Decision authority* lists it there (a split, a deferral to a ticket queued
without a demand gate); a decision on its ask list goes to the user. An extension of the scope
(`decide --widen`) must still pass the slice size check, or it is a new ticket. If no decision is
taken, stop and report plainly which claims will not survive, what each pass said, and what the
design cannot currently establish. An honest report of an unstable design is a result; a design
reported as finished because the loop ran out of patience is worse, because it arrives with a green
attached.

**Machine-clean is the bar, and the human-owed partition is not a queue to empty.** `check` will
always list qualified verdicts, `proc:` extents, self-grounding and its own standing non-coverage.
Surviving qualifications belong in the report, in the grounder's own words.

**Never report a design that has not been independently grounded.**
