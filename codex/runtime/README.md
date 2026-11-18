# Codex runtime candidate

This directory is copied to CODEX_HOME/lonic/runtime by the global-default installer,
or PROJECT/.codex/lonic/runtime with --scope project.
Copying it does not activate hooks, create a new login/profile, or edit Codex config.toml. Node.js 18+ is required. The separate evidence and queue CLIs start
native Codex processes using the existing login and the configured model.

## Configuration

Create CODEX_HOME/lonic/runtime-config.json or the project override
.codex/lonic/runtime-config.json only with setup authorization. The installer
ships runtime-config.example.json, never overwrites the operator configuration.
Without --config, queue and evidence load the global configuration, then apply
project overrides for schema, model and timeoutMs. A project file containing
another key fails with an error. Configure executables, allowedCommands and
runRoot globally or in an explicitly selected standalone --config. Runtime and ordinary entry-skill lookup prefer the project then
CODEX_HOME; resolve-installation.cjs PROJECT queue|evidence prints selected paths.
Managed retains its explicit configuration/admission contract.

In the commands below, replace RUNTIME with that selected absolute runtime path;
quote the script path if it contains spaces. A global installation does not need
another copy in each project. The user-level tetel config.toml snippet and the
Windows 0.167.0 discovery limits are in ../README.md in the source distribution
(codex/README.md); config.toml registration remains a separate manual step.

User-level tetel registration, manually merged into CODEX_HOME/config.toml:

```toml
[mcp_servers.tetel]
command = "tetel"
args = ["mcp"]
```

Use an absolute native executable path when it is not on PATH (Windows example:
command = 'C:\tools\tetel.exe'). In the isolated Windows Codex 0.167.0 zero-turn
probe this user registration exposed 14 tools without project trust. Tool calls
by a model were not tested. The installer never edits this configuration.

Example:

```json
{
  "schema": 1,
  "codex": "codex",
  "tetel": "tetel",
  "model": "YOUR_APPROVED_MODEL"
}
```

The example above assumes native executables resolve on PATH, as on Linux.
On Windows, use absolute paths to the actual `codex.exe` and `tetel.exe` files:

```json
{
  "schema": 1,
  "codex": "C:\\path\\to\\codex.exe",
  "tetel": "C:\\path\\to\\tetel.exe",
  "model": "YOUR_APPROVED_MODEL"
}
```

These are placeholders, not installation paths. Locate and verify the binaries
from your existing installations. An npm `codex.cmd` shim is not a native executable:
the runtime uses Node's `spawn` without a shell and cannot launch `.cmd` or `.bat`
shims this way. An absolute shim path does not fix this. No shell fallback is enabled.

Child processes inherit `CODEX_WINDOWS_REGISTERED_CORE` if their launcher sets it.
Launch behavior with that variable present has not been validated by this review;
prior lab harnesses removed it. A shell-only launch failure requires investigation,
not a change to global environment or login settings. The runtime does not strip it.

Evidence also needs Git, grep and wc on PATH (Git for Windows supplies these). Optional
allowedCommands is an array of exact argv arrays. Optional runRoot is outside the
source repository; otherwise runs use the OS temporary directory. For evidence
passes, timeoutMs is 1000..900000 (default 240000). For ordinary controller
sessions it is 1000..43200000 (default 7200000, two hours); --timeout-ms overrides
the config for that queue invocation. A shared config value therefore affects
both CLIs, and evidence still rejects values above 900000: use separate configs
or the queue CLI override for longer work. The B1 --managed branch keeps its
mandatory explicit --timeout-ms and separate 24-hour maximum. Never put
credentials in this file.

Read the installed design-doc and queue-run runtime references for exact CLI
commands. They are the maintained agent-facing contracts.

## Evidence

The gateway binds each pass to its source root, HEAD, memo, workspace and exact
commands. Grounding requires stable memo/snapshot, matching before/after claims,
append-only evidence, and witnessed records for every initially owed claim.
Attack completion additionally requires complete captured memo ranges, check,
a structured decision-cone report and matched finding receipts. A missing-claim
finding must cite a fact actually minted during the pass.

The initial pair shares a pre-pair check to withhold peer findings; both write
the actual memo ledger and a fresh check follows. This is a documented check-view
adaptation, not two passes each seeing a fresh ledger. Failed/partial passes
retain evidence and stop. A later closure attack uses a current check.
Completion means the pass finished, not that every claim is true or the design
is approved. The main author must adjudicate refutes, qualifications and missing
premises. Git HEAD alone does not pin uncommitted file contents.

Loaded instruction sources are checked before an evidence model turn. The worker
disables unrelated extensions and skills, but some native helpers remain. It is
not exact seven-total-tool parity or protection from hostile changes by the same
OS user. Exact allowed tetel run commands execute outside the native worker's
read-only boundary; their side effects require separate review.

## Queue

The controller uses real account/rateLimits/read data, an explicit weekly budget,
fresh sessions, explicit skill inputs and complete immutable checkpoints. It
stops on missing/ambiguous/expired readings, account/reset changes, exhausted
short windows, a reached threshold, failed turns, or missing handoffs. An attached terminal can handle native approvals and questions; otherwise
work needing decisions is parked. The same controller supports bare powerup
with a fixed item ID across phases. Automatic crash recovery is not implemented.

The configured ceiling applies only to the weekly window. Other windows stop
the run at exhaustion (100%). Budget checks run before each session and when the
session calls `context` or `handoff`; they do not interrupt a running turn when
the ceiling is crossed. A long turn can therefore exceed the requested ceiling.

Author-session instruction sources are retained in raw `events.jsonl` responses.
They are not checked against an approved list or summarized in `result.json`.
Review inherited instructions before unattended author work. Evidence workers
have a separate instruction-source check; that check does not cover authors.

The budget and operator-decision files are not isolated from an author session
that can write the run directory, including a writable temporary directory.
Such a session can alter the budget or inject decision history into a later
checkpoint. These files are not an enforced spending boundary or authenticated
operator approvals. This authority-state issue remains open for a separate design.

Checkpoints use flushed files plus exclusive hard links and SHA-256 readback.
Unsupported filesystems fail. A claimed checkpoint is not automatically replayed.
Checksums detect corruption, not hostile replacement. Static symlink/junction
checks do not prevent every concurrent filesystem race. Reported source state
must be rechecked by the next session. Usage receipt age cannot prove backend
measurement freshness; exact usage stops and cost savings are not guaranteed.

### Stale lock recovery

Locks are not automatically reclaimed after a crash:

- Queue: `os.tmpdir()/lonic-codex-queue-locks/<project-hash>.lock`.
  The hash is SHA-256 of the real absolute project path, lowercased on Windows.
  Its JSON contains `runId`, `pid`, `project` and `queue`.
- Updater: `<project>/.codex/lonic/update.lock`. Its contents are the approved
  plan's SHA-256, not a process ID. Cleanup failures can leave this file behind.
- Attack pair: `<memo>.lonic-attack-pair.lock`, containing the pair ID and PID.

On `EEXIST`, preserve and inspect the exact lock and associated run/plan receipts.
Verify that the original owner and its children have stopped; a PID alone is not
sufficient because operating systems reuse IDs. Reconcile partial writes,
checkpoints and unresolved decisions before an operator removes that exact stale
lock. Never delete a lock merely because it is old. A claimed checkpoint remains
claimed; lock removal does not authorize replay or a new budget. For updates,
retain the plan's original bytes and any `needs-reconciliation` receipt, compare
the current target bytes and recover deliberately before creating a new plan.

## Optional test-output hook

hooks/filter-test-output.cjs handles simple recognized test commands. Complex
shell expressions and quoted arguments are left unchanged. FULL_TEST_OUTPUT=1
in the environment, or that literal marker in the command, skips filtering.
The wrapper retains stdout/stderr in an OS-temporary lonic-test-output-*/full.log
and returns the child exit status. Long output is an excerpt; consult the full
log before concluding that omitted failures do not exist. Logs are retained
until the user/OS removes them; do not put secrets in test output.

The project installer only copies these scripts. Activation needs a reviewed
project hooks.json entry and Codex's native hook trust. Synthetic approval tests,
real shell exit/log tests, and approved native hook activation passed in the
Windows and Ubuntu demos. Every new installation still needs explicit activation.
Direct script tests alone do not establish native hook coverage.

Operator decision U1 retains this documented difference: the Codex hook returns
`permissionDecision: "allow"` with its rewritten command;
the Claude hook omits that decision. Preservation of `untrusted` command approval
has not been established. The independent Windows probe could not reach its
local scripted provider, so it did not exercise the hook or an approval decision.
A rewritten command starts with `node -e`. Prefix-based deny or ask rules for the original command may therefore stop matching. Enforcement of those rules remains unverified (U1). Non-default sandbox permission requests and unrecognized flags pass directly to the host. `npx` and `bunx` tests require a local runner and execute that shim directly.

## Measured scope

The source has Windows and Ubuntu unit tests, real separate-process grounding,
real initial attacker pairs with witnessed refutations, and native two-session
queue probes using local scripted model replies and real account usage reads.
Scripted queue probes verify loading and transport, not autonomous judgment.
Separately, real native authors completed a bounded three-file task on each OS:
design, independent attacks and grounding, fresh-session implementation, native
review and host tests. Each final implementation passed six fixed examples.
The Windows reviewer reported a missing phase record and unknown Git status;
the host separately verified the complete three-file source aperture and diff.
The original lab reviewer counter missed the native subAgentActivity event;
retained start/completion events proved one reviewer per OS. These qualifications
remain part of the acceptance record. This is not exhaustive behavioral parity.
Claude phase-handoff and cost-log mods are not installed as Codex extensions.
Performance, cost and quality improvements remain unmeasured.

A Codex CLI 0.167.0 Windows process-lifecycle probe observed the candidate gate
and tetel exit after both normal app-server closure and direct app-server
termination. This bounded, idle MCP probe does not establish cleanup during
active commands or every process-tree failure mode.

## Operator and phase controls

Example syntax only; substitute approved paths and budget:

```text
node RUNTIME/queue.cjs --project ABSOLUTE_PROJECT --queue ASSIGNED_TASK_FILE --item-id TASK_ID --entry powerup --authority-file AUTHORITY_FILE --threshold USER_PERCENT --max-steps 2 --interactive
```

The same launch supports queue-run and powerup-auto. Automatic continuation is
available in controller sessions, not injected into an existing ordinary chat.
--interactive requires a terminal. Questions and approval details appear there.
Type approve for one native request, decline to refuse, or leave a question
empty to park it. No persistent approval rule is granted. A permission-profile
grant lasts at most the current turn. Text answers do not bypass native checks.
Unhandled requests stop the run. Known refusals go back to Codex and are retained.

Optional --availability-file reads JSON like this (EXAMPLE schedule):

```json
{"timeZone":"Europe/Budapest","windows":[{"days":[1,2,3,4,5],"start":"09:00","end":"17:00"}]}
```

Days run Monday=1 to Sunday=7. Overnight windows belong to their starting day.
Daylight-saving transitions use the IANA timezone. No file means the attached
operator may answer at any time. A file without --interactive is rejected.
--operator-timeout-ms defaults to 120000. Timeout or window closure parks the
request. Work continues only within previously granted authority.

The host saves each handoff, then waits 20 seconds. Ctrl+C cancels continuation.
--handoff-delay-ms changes this delay (0..60000). Each next session checks budget
again. Interruption requests native cancellation. Uncertain termination is
recorded for reconciliation; the controller does not blindly retry.

## Usage and costs

In ordinary (non-managed) mode, file-backed run state lives under the configured
runRoot or the OS temporary directory's lonic-codex-queues folder; the project
lock remains in the OS temporary directory. The controller checks the budget
before sessions, and lonic_queue context/handoff also refresh and check it.
Between those checks, budget compliance depends on the cooperating author;
these checks and file-backed state are not a security boundary against that
author. This is the ordinary-mode consequence of the B1 finding. The explicit
--managed mode is the experimental response, with its separate documented
controls and limits; it is not implied by an ordinary controller session.

Each step retains events.jsonl, usage.json and operator-decisions.json.
lonic_queue context combines account limits and last reported request size.
cost_log reports observed thread/turn usage and heavy turns. Missing child events
are not zero and are not claimed as complete agent costs. Cache writes are
observations; their cause and cache lifetime are not inferred.

No prices are assumed. Optional --prices-file supplies inputPerMillion,
cachedInputPerMillion, cacheWritePerMillion, outputPerMillion, model, source and
asOf. Rates are USD per million tokens and must match the configured model.
API-price equivalents are not subscription charges. Child costs stay unknown
without an effective model. context nextPhaseTokens adds estimated break-even
only when the needed measurements and prices exist. It assumes fresh uncached
input versus retained cached input. It is not measured savings or a cache guarantee.

Offline report: node usage-report.cjs EVENTS_JSONL MODEL MAIN_THREAD_ID [PRICES_JSON].
Logs can contain source and user answers. Keep them in the approved state directory
with suitable access. Do not send them to others without approval.

Weekly reset comparison tolerates at most one second of timestamp variation against
the original run anchor. The anchor and percentage ceiling never move. A larger
change, elapsed original reset time, lower usage, or account change stops the run.
A stopped run remains stopped; this tolerance cannot reopen an old grant.

## Explicit B1 managed option (step 5)

The `--managed` option selects the separate B1 mode explicitly; ordinary controller sessions do not imply this mode. It is experimental: narrow native observations cover enrollment, admission, handoff, cancellation, Node-substitute forced closure and ordinary reconcile; file work is unverified and command execution is not authorized, supported or observed. Ordinary calls are unchanged. Read [managed CLI, enrollment and limits](managed-cli.md) before selecting it: `--queue-kind file` and an explicit author timeout are mandatory; native hooks (including lonic's filter) are forbidden. Clean bounded work can return `incomplete` with preserved context. No native probe starts automatically.

## Evidence deadlines and oversized briefs (E7 / B18)

The evidence deadline bounds one grounder or attacker turn, not the entire
preflight/cleanup sequence. Its timeout diagnostic names the role and elapsed
allowance; the failed result preserves the diagnostic and partial audit. Inspect
claim count, complete-brief size, actual prior event timings and partial progress
before raising timeoutMs. A large but progressing pass may justify a separately
reviewed increase within 1000..900000; a blocked RPC, invalid brief, denied source
or profile drift is not repaired by waiting longer. Do not automatically retry.
An attack-pair has two separate turn deadlines and two model calls.

A complete grading brief must fit tetel's 32768-byte UTF-8 reply bound. This is
the serialized claim brief, not the Markdown memo size. Tetel may drop duplicate
structured content while retaining complete JSON text; that alone loses no data.
If the content itself exceeds the bound, tetel returns a cut-reply marker. The
runner now reports BRIEF_REPLY_TOO_LARGE with the limit and repair instructions,
instead of a JSON parse error; malformed JSON has BRIEF_REPLY_INVALID_JSON.
Before-turn detection prevents a model turn; a changed/invalid final brief still
invalidates completion. More timeout or raising a client token limit cannot fix it.

Split independent claim groups into smaller independently checkable memos, retain
all decisions/targets/tests and explicit dependencies, move explanations to prose,
then render/check and inspect each fresh MCP brief for every expected claim. Do
not split only the request's owed list: brief carries all propositions. Do not
classify a truncated subset or bypass the bound by reading the author's plan.

## Controller-session deadlines (B19)

Ordinary queue-run, powerup-auto and controller-driven powerup sessions default
to 2 hours (7200000 ms), accepting explicit 1000..43200000 ms (12 hours). This
is a per-turn controller deadline, not permission to run for that duration or a
spending cap. The explicit budget, stop, max-step and operator-authority rules
remain in force; timeout interrupts and stops chaining. The ordinary weekly
budget is sampled at boundaries and does not interrupt a running turn at the
threshold, so choose a shorter deadline when cost/headroom requires it.

The RPC client's 30000 ms default bounds each outstanding request/reply (including
turn/start acknowledgement), not the subsequent turn/completed notification.
Operator wait is separately 120000 ms by default, maximum 900000, bounded further
by availability; expiration denies/parks that request and does not shorten the
whole session to 15 minutes. The queue CLI forwards its timeout override/config
value without a second 15-minute clamp. Managed B1 author deadlines are unchanged.

## Pult module-directory quoting (U3, unresolved integration limit)

The supplied pult.module.yaml templates interpolate ${module.dir} without shell
quotes. Pult's expansion/escaping implementation was not available in the local
checkout and could not be verified from the referenced public source. YAML
quoting of the template does not prove shell-argument quoting. Do not rely on
these Pult entries when the source path contains spaces or shell metacharacters.
Use the documented direct Node installer/updater CLI with an absolute, correctly
quoted script path and separately quoted arguments, retaining preview/approval
requirements. No Pult escaping or space-path compatibility is claimed here.
