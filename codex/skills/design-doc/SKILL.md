---
name: design-doc
description: "Explicit design mode: ground consequential decisions in current evidence, then close through attack and grounding before implementation."
---

# Design-doc mode

Announce that design mode is active for the session. Activation is not a request
to write a design now. This mode does not add installation, publication, or merge
authority. User-required approvals still apply.

Before actual design work, read [the design method](references/method.md).
It owns design classification, the claims/spike ledgers, invariant falsifiers,
class analysis, and the evidence needed for closure.

## Select the evidence route

Use tetel when its tools are available, including deferred MCP tools. Read an
existing `.codex/lonic/design.json` project preference if present. A recorded
`route: tetel` means missing or failing tetel stops the work; do not quietly
switch to prose. Save such a preference only when the user requests it.

Without tetel and without that preference, use the method's prose route and
the sibling delivery skill's medium-or-lower review gate. Consult, when active,
adds the advisor's adversarial read. The main agent authors the design.

The tetel route also requires a working, explicitly configured evidence-pass
runner. Ordinary Codex custom agents inherit permissions and MCP connections;
calling one a grounder does not isolate it. If the runner is unavailable or its
preflight fails, report the missing capability. Do not replace it with an
unrestricted agent or report independent grounding that never ran.

## Author and revise

Call tetel brief with authoring enabled for the current authoring guide. Check
the source commit first. Work in questions: observe source with look/run before
deciding the answer, then mint facts and claims. Native discovery may locate a
file, but do not read it fully through another path and later recapture it merely
to manufacture a citation. Open the needed ranges through tetel.

Use one explicit author workspace. Keep the planning directory separate from
the pinned source repository. A fact's extent must support its full note.
A rejected assumption changes the design; a revision names its factual reason.
Two reversals of the same decision without new evidence stop that question.
Report the competing evidence and the observation that would settle it.

Place prose as it is written. At the editorial pass, review each paragraph with
its claims. Revise flow only; a new assertion requires returning to observation.
Read current prose IDs before revising a batch. Do not reconstruct IDs from order.
Render the memo and run check before spending an evidence pass.

## Attack, revision, grounding

Read [the Codex dispatch contract](references/runtime.md) before the first pass.
Use its installed CLI and completion checks. The evidence loop itself is the review;
do not ask the user to review the plan in place of it. User-required approvals
remain binding and separate from that review. Keep pass IDs,
workspace identities, and current artifact digests in the design record.

1. Attack the current memo. An attacker reads the actual rendered
   memo and its permitted artifacts through tetel, but cannot query the author's
   or a grounder's workspace. Its target is the decision cone, not prose style.
   Obtain two independent attacks of the same initial text before revising it;
   do not show the second attacker the first one's findings. Use attack-pair, which
   runs serially with a shared pre-pair check and a fresh check after both passes.
2. Revise the design in response. For refutes, repair the decision as far as the
   evidence reaches. For qualifies, state the condition or obtain missing evidence.
   Do not restyle a supported claim just to put it back out of proof.
3. Ground the revised memo. Supply the memo path, a fresh bound workspace identity,
   and the runner's source-repository/pin metadata. Do not supply propositions,
   summaries, suspicions, author facts, or prior conclusions. The grounder gets
   every proposition and its owed subset from its own brief call. Do not send a
   claim supported only by your own design documents: the bound grounder cannot
   classify that self-citation. Obtain independently readable source evidence
   before admitting it to the groundable claim set; otherwise keep the unverified
   statement and its proof debt explicit in design prose. Never silently omit
   claims from a partial brief to manufacture completion.
4. Repeat when decision-changing findings or refutations remain. Before closing,
   if revisions landed after the last attack pass, attack the current text, at any
   check verdict and any round count. A failing machine-check report is data for the
   attacker; it does not waive the machine-clean requirement for closure.

A refutation also reopens sibling claims about the same substrate: inspect and
revise their shared premise, not only the cited claim.

An external-state refutation must be answered against that same external state.
Source code cannot replace a live observation when the claim concerns a deployed
system. If the required source or execution capability is unavailable, preserve
that obligation instead of substituting an easier adjacent claim.

Keep bounded investigative effort at medium. Do not promise Claude cache TTLs,
prices, or savings on Codex. Reuse a pass only when the runner actually retains
its context and workspace. A process that closed cannot be resumed by saying its
old ID; a fresh pass gets a fresh identity and is reported as fresh.

Wait for each pass's terminal result. Do not poll tetel workspaces to infer agent
completion. A completed model turn is insufficient: verify current brief, stable
memo/snapshot, and witnessed ledger receipts. An incomplete or invalidated pass
stops the loop and leaves explicit recovery work.

## Close the design

Grounding completion is not design approval. It can include refutes or qualifies.
The closing attack must have read the text being closed. The design closes when
check is machine-clean, no refutation remains, and the current attack yields no
finding that changes what an implementer would build. Qualifications and other
human-owed rows remain visible in the report; do not turn them into a green score.

Cap grounding at four rounds. The cap never excuses a missing final attack.
At the cap, unresolved decision-changing findings mean unfinished design. Record
editorial findings without buying another round solely for prose polish.

Report the memo path, actual check result, independent passes and identities,
surviving qualifications, any unreadable or execution-owed area, and whether the
final attack covered the current artifact. Never close without independent
source grounding. Do not add a redundant code-review pass to a completed tetel
memo. Implementation and its diff still need the delivery review gate.
