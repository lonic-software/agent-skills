# Codex support candidate

This local candidate contains all seven lonic workflow skills. The original
Claude skill and agent sources remain unchanged. See upstream-sources.json for
the source revision and hashes. Bounded installed-demo workflow acceptance passed
on Windows and Ubuntu. Independent PR review and publication remain separate.

Selections: consult, delivery, evolve, core-preview (the original three skills),
design-doc, queue-run, powerup, powerup-auto, full-preview, test-filter-hook.
Full-preview includes all seven skills, six native advisor/reviewer definitions,
and the evidence, queue and optional test-output runtime. Evidence workers are
separate native processes, not ordinary custom-agent roles.

The `test-filter-hook` selection copies the entire runtime directory, including
queue and evidence scripts. It does not activate those scripts or the hook.
The Codex `design-doc` workflow requires two independent initial attacks before
the first revision. This deliberately adds one initial attack compared with the
Claude workflow and can increase first-round model usage. It is not a cost-saving claim.

See [runtime contracts and limits](runtime/README.md). The source includes real
Windows/Ubuntu evidence-worker probes and native queue transport checks. Managed bare powerup supports automatic phase handoff. An attached terminal can
answer questions and native approvals within optional availability windows.
Ordinary Codex chats still need the controller for automatic phase changes.
Native hook activation and complete small author-driven workflows were checked
in both demos. These bounded examples do not prove every workflow or input.

Native advisor/reviewer roles in this preview have read-only instructions;
they do not create separate OS permission boundaries.

## Project-local setup

Requires an existing Codex installation and Node.js 18 or later. This setup
does not download dependencies. Tetel is configured separately in the project's
`.codex/config.toml`. The installer does not edit that file, `AGENTS.md`, user
configuration, credentials, or hooks. Use a standalone project outside any
unrelated repository and start a new Codex session there.

Preview from this repository on Linux or Git Bash:

```sh
bash bin/install codex core-preview --project /absolute/path/to/project
```

Preview from PowerShell:

```powershell
& .\bin\install.ps1 codex core-preview -Project 'C:\path\to\project'
```

The preview lists destination paths, current status, and source SHA-256 hashes.
After reviewing it and obtaining any required installation approval, repeat
with `--apply` (bash) or `-Apply` (PowerShell). Without that flag nothing is
installed. Use `full-preview` in place of `core-preview` for the complete candidate.
`evolve` includes its consult dependency. The original core-preview creates 12 files:
three SKILL.md files, three invocation-policy files, and six agent TOMLs.

Skills go under `<project>/.agents/skills`. Agent definitions go under
`<project>/.codex/agents`. Existing identical files are retained. Different
content is a conflict: the installer refuses the whole operation. It never
deletes an installed skill directory. Symlink/junction targets are rejected.
If copying fails, rollback removes only new files with the expected bytes;
changed files are retained and reported. This is not a transaction against
hostile concurrent filesystem changes; avoid concurrent setup/edit operations.

Project configuration and custom agents require the normal Codex project trust
review. No trust bypass is used. User-wide instructions, skills, and plugins may
still be inherited; project-local setup is not a filesystem security boundary.

Compare installed files with the chosen source selection:

```sh
bash bin/check-sync codex --project /absolute/path/to/project --skill core-preview
```

PowerShell uses the same check:

```powershell
& .\bin\install.ps1 codex core-preview -Project 'C:\path\to\project' -Check
```

Exit 0 means the selected files match; 2 means missing/different files; 1 means
a usage, configuration, or filesystem error. This is source/install checking,
not a claim that Claude and Codex behavior is equivalent.

## Try the modes

All seven skills preserve the original explicit-only invocation policy. In a fresh
project session, invoke `$powerup`, or an individual skill, and provide the
task. No language preference is imposed by this package.

Consult resolves the user's advisor model and baseline effort before use.
For a session-only diagnostic, the prompt can supply both without writing a
preference file. The roles do not hardcode a model or inherit Claude pricing
and cache guarantees. Use an exact model available to your Codex account.

Example test prompt (synthetic demo data):

```text
Use $consult for this diagnostic and respond in English.
For this session only, use gpt-6.1-sol with low advisor effort.
Ask one lonic-advisor-low to read example.txt and report its non-empty line
count and last line. Then ask the same completed advisor to repeat the last
line from memory. Do not edit files or save preferences.
```

For evidence and queue execution, create the reviewed runtime-config.json described
in runtime/README.md. The installer copies no machine-specific executable paths.
Use the exact CLI contracts linked from design-doc and queue-run. Hook scripts
are copied inert; project hook registration and native trust are separate steps.

This diagnostic tests role dispatch and continuation. It does not test the independent
grounder or prove enforced read-only access.

## Validation

Run the dependency-free installer tests:

```sh
node --test tests/install-codex.test.cjs
```

They use dummy file content, not live installed skills. Tests cover read-only
preview, repeat application, conflicts, destination/source changes, path
traversal, symlink/junction rejection, and reporting a partial write failure. Real Codex skill loading and model
behavior require separate tests; parsing alone does not establish them.

## Pult and reviewed upgrades

The module adds codex-install, codex-check-sync, codex-update-plan and codex-update.
Existing Claude commands keep their behavior. Node.js and Codex/tetel must already
be installed. Pult uses Bash on Windows (Git for Windows). These commands do not
install pult or dependencies. Select a project path explicitly. codex-install
previews by default; its apply flag needs installation authorization.

Prepare changed package files with bin/manage-codex.cjs preview --project PROJECT
--skill powerup-auto --plan PLAN_JSON. The plan retains old/new bytes and prints
the exact SHA-256 and file list. Review before running apply --plan PLAN_JSON
--approved-sha256 HASH. rollback with the same plan/hash restores old bytes and
removes only matching newly created files. A later edit blocks the whole operation.
Keep the plan and application record as backups. Obsolete files are not deleted
automatically. User customizations are not merged automatically.

Do not update concurrently with agents or editors. The lock coordinates this
updater, not all file writers. Partial failure retains a recovery record.
See [stale lock recovery](runtime/README.md#stale-lock-recovery) before recovering
an interrupted update. Keep both the plan and its receipt; never infer completion
from the absence of a running updater alone.
Configuration, tetel registration and hook activation remain explicit setup steps.
These commands do not change credentials or grant native hook trust.

## Explicit B1 managed option (step 5)

The new `--managed` option is opt-in and is not the older generic "managed bare powerup" wording above. It is experimental: narrow native observations cover enrollment, admission, handoff, cancellation, Node-substitute forced closure and ordinary reconcile; file work is unverified and command execution is not authorized, supported or observed. Ordinary calls are unchanged. Read [managed CLI, enrollment and limits](runtime/managed-cli.md) before selecting it: `--queue-kind file` and an explicit author timeout are mandatory; native hooks (including lonic's filter) are forbidden. Clean bounded work can return `incomplete` with preserved context. No native probe starts automatically.
