# Design-doc: rationale

The incidents and measurements behind design-doc's rules, by the file that holds each rule.
`SKILL.md`, `method.md` and `loop-tetel.md` hold the rules; this file is read only when changing
them (evolve).

## loop-tetel.md

- **Cost lives in carrying.** The 5-minute subagent default cost one measured design two ~300k
  rebuilds across revision rounds.
- **Read in ranges.** Measured across two runs, the opening 30 requests carried ~73% of the entire
  tool-result cost.
- **The editorial pass mints nothing.** The highest-severity defect in the first tetel memo was a
  keystone claim that existed only in prose, under a citation to a claim that said something else,
  and it entered during exactly such a writing phase. A `prose --revise` against the wrong id
  replaced headings twice in one memo.
- **Spawn every pass synchronously.** A designer left with detached passes spent 15% of its entire
  budget calling `workspaces` in a loop, polling for children it could not have waited for; the
  polls' own output then became the single largest thing in its context.
- **Attacker first, never beside a grounder.** They overlapped on 7 of 7 passes in one measured run
  purely because both were dispatched detached. Measured attacker round 0 on two designs: 57 turns
  in 14 minutes, and 64 turns in 23 minutes; the attacker provokes roughly 0.83 revisions per record
  and a grounding pass 0.06–0.47.
- **A claim refuted from outside the worktree.** Three read-mechanism claims asserted in prose were
  each refuted against the live system by a later pass — five rounds, ~4.5M tokens — and four
  scripts then settled every remaining question in twenty minutes. In that run's ledger of 155
  records, exactly the five refutations witnessed by live-system calls were the mechanism failures;
  the ten witnessed from source were contract-level.
- **A designer's brief leads with the surface.** One design briefed as "an admin UI" plus five
  unsettled substrate questions came back answering all five and containing no feature set, no
  screens, no auth model and no data model.
- **Run an attacker every round.** The attacker was for a long time spawned only to re-validate a
  refutation's fix, so it ran only when a grounder had refuted something; across four memos nothing
  ever was, so the highest-yield instrument never ran at all.
- **A refutation's fix is re-validated by an attacker.** A repair was graded `supports` twice,
  correctly, and the next attack pass showed it unsound at its destination; it cost a round.
- **A dry grounding round is not the signal.** On one run, pass 1 was a dry grounding round and the
  attacker after it provoked eight revisions; passes 5 and 7 were also dry, and their attackers
  provoked 8 and 5. Stopping at the first dry round would have discarded 24 of that run's 35
  revisions.
- **"Stop when the last round provoked no revision" is unreachable.** Measured on one loop:
  refutations fell 2 → 1 → 1 → 0 across four attack passes while qualifications did not fall at
  all. All three of that run's final qualifications were the same shape — a single clause saying
  *only*, *never* or *permanently* about a claim that was right in substance.
- **Do not run one more round to be sure.** One memo paid for that: two consecutive dry grounding
  rounds, 55 records between them, nothing changed by either.

## method.md

- **The answer is the bound, not the member.** One memo spent five consecutive rounds appending
  missing members while its decisions had stopped moving.
- **Resolving an unknown changes the design.** When a real instance was chased down, the "unknown"
  turned out to hide a third code path whose failure mode was worse than the defect the doc was
  written to fix.
