# Codex evidence dispatch

## Installation lookup (Codex 0.167.0 port)

Resolve RUNTIME to the project's .codex/lonic/runtime first, otherwise
CODEX_HOME/lonic/runtime (CODEX_HOME defaults to the OS home/.codex).
Use the selected absolute path, quoted as a separate shell argument.
The read-only helper at either installation, resolve-installation.cjs, accepts
PROJECT and queue or evidence and prints the selected runtime/config paths.
Set executables, allowedCommands and runRoot in `CODEX_HOME/lonic/runtime-config.json`
or in a standalone file selected with `--config PATH`. A project-only installation
ships the template at `PROJECT/.codex/lonic/runtime-config.example.json`. Copy
it to the global path, or edit a separate copy and pass it with `--config`.
During automatic lookup, `PROJECT/.codex/lonic/runtime-config.json` may
override only `schema`, `model` and `timeoutMs`.
Do not infer an account, model, budget or authority from installation scope.


Read this when the tetel design route is selected. The installed runner is
`RUNTIME/evidence.cjs`. Configuration is resolved as described above. Missing files are a setup requirement, not
permission to install them. Keep the main session's authoring tetel connection.

The configuration names the existing Codex and tetel executables, the approved
model, and optional exact captured commands. Node.js 18+, Git, grep and wc must
be available. Use the existing native login. Do not create or switch profiles.
A nonempty inherited instruction source stops an evidence pass before its model
turn; report the actual source instead of silently removing it.

Store the rendered memo outside the source Git worktree. Invoke from the project
root, replacing the labelled example paths with the actual absolute paths:

```text
node RUNTIME/evidence.cjs --mode attack-pair --repo ABSOLUTE_SOURCE_ROOT --memo ABSOLUTE_MEMO_PATH
node RUNTIME/evidence.cjs --mode grounder --repo ABSOLUTE_SOURCE_ROOT --memo ABSOLUTE_MEMO_PATH
node RUNTIME/evidence.cjs --mode attacker --repo ABSOLUTE_SOURCE_ROOT --memo ABSOLUTE_MEMO_PATH
```

Quote paths containing spaces according to the active shell. These are separate
commands for the appropriate stage, not a sequence to run without adjudication.
Use attack-pair for the two initial attacks, grounder for owed grounding, and attacker
for later attacks of the revised text. Before closing, if revisions landed after
the last attack pass, attack the current text at any check verdict and round count.
Revisions do not by themselves require an attack before further grounding.
A well-formed failing check report counts as checked for that pass; transport,
gate and malformed-report failures still stop it. Closure still requires a
machine-clean check, no refutation and no decision-changing finding.
Wait for each process to finish and read
its saved result. Exit 0 means that pass completed; 2 means incomplete; 1 means
startup/execution failed. None means design approval.

Each pass has a fresh workspace, captured tool audit, native thread ID, and result
file. A completed process is not a reusable advisor. The initial pair shares the
check captured before either attack. Peer findings are withheld from that check;
records append to the real memo ledger. The pair then obtains a fresh check.
Memo, snapshot or source-pin changes invalidate the pair. A failed first pass
stops the second. Keep partial records and inspect them before retrying. Do not
remove a leftover pair lock until the prior process has been reconciled.

The grounder cannot read the memo or its artifacts. The attacker can read the
memo and snapshot; neither can read the external evidence ledger directly or
query another workspace. The gateway exposes seven tetel operations per role.
Native Codex framework helpers remain visible, so exact seven-total-tool parity
is not claimed. Instructions prohibit using those helpers as source channels;
this is not a new OS security boundary.

Captured run commands require exact argv allowlisting in the reviewed config.
They run through tetel outside the worker's native read-only boundary. Audit the
command's real effects before allowing it; a test can write files. Do not add
commands just to bypass a refusal. Missing execution evidence remains owed.
Git HEAD pins the commit, not the full working tree. Preserve the captured dirty
source evidence and recheck relevant state at each phase.
