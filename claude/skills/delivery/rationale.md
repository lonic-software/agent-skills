# Delivery: rationale

The incidents and measurements behind delivery's rules. `SKILL.md` holds the rules; this file is
read only when changing them (evolve).

## §B. CI is not the first test run

The seeding incident ran filtered e2e subsets locally; CI then went red on three OSes over six
assertions a few-second run of the one test file would have caught.

## §B. Review starts once the local suites pass

A first CI run fails on only a small share of changes whose local suites ran green, so waiting
before every review cost about ten minutes per change to avoid a case that produces a fix round
anyway.

## §B. One reviewer per change

Verified: a completed review agent resumes with its diff, its mutation runs and its findings
intact. Measured at ~100k, a cold resume and a fresh `/code-review` with the full block cost about
the same.

## §C. Non-convergence owes a direction check

Eight rounds whose blocker counts never reached zero for long (3, 4, 3, 2, 1, 3, 0, 1), with the
diff growing every round to almost seven times its first size. The escalation signal fired three
times, and each time the remedy was restated as the root fix, inside the PR, framed as needing no
design reopen.

## §C. A tracker write that fails is an owed action

A transition that failed on a connection that was not granted was reported once and never retried,
and two more items finished that night were never transitioned at all; three finished tickets sat
in To Do until the user noticed.

## §D. Evidence matches the clause's class

The revert-check written for every clause, docs and wording included, ran a dozen mutation commands
per item and three sessions each hand-wrote their own runner, while the suite's own run time stayed
flat — the ceremony, not the suite, was the cost.

## §D. Revert-check gate

A restore over uncommitted work destroyed it, twice; a restored file with an older timestamp let
the build tool run a stale binary; a non-compiling mutant was counted as red; a hand-written runner
read the runner's own "test failed" line as a compile error. Each was a session re-inventing the
runner.

## §D. A red run certifies the assertion that produced it

The seeding incident shipped `not.toBe` on an array, identity-true forever, and the revert run's red
came from the line above it.
