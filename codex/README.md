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
Windows/Ubuntu evidence-worker probes and native queue transport checks. Controller-driven bare powerup supports automatic phase handoff. An attached terminal can
answer questions and native approvals within optional availability windows.
Ordinary Codex chats still need the controller for automatic phase changes.
Native hook activation and complete small author-driven workflows were checked
in both demos. These bounded examples do not prove every workflow or input.

Native advisor/reviewer roles in this preview have read-only instructions;
they do not create separate OS permission boundaries.

## Installation scope (global by default)

Requires Node.js 18+ and an existing Codex installation. Preview never installs;
only --apply writes. The default scope is global: CODEX_HOME, or the OS user
home/.codex when CODEX_HOME is unset. --codex-home can select another profile.
One global installation serves subsequent projects without reinstalling there.

From this repository, preview and then apply the complete bundle:

```text
node bin/install-codex.cjs --skill powerup-auto
node bin/install-codex.cjs --skill powerup-auto --apply
```

For project-only installation, choose the scope explicitly:

```text
node bin/install-codex.cjs --scope project --project /absolute/project --skill powerup-auto
node bin/install-codex.cjs --scope project --project /absolute/project --skill powerup-auto --apply
```

The Bash wrapper is bash bin/install codex powerup-auto [the same flags].
PowerShell: & .\bin\install.ps1 codex powerup-auto defaults to global; add
-Scope project -Project 'C:\path\to\project' to select project scope, and -Apply
only after preview. -CodexHome and -OnDuplicate keep-both are also supported.
No dependency download, config.toml, AGENTS.md, login, hook registration or trust
write is performed. Runtime scripts are inert until invoked.

| Content | Global | Project |
| --- | --- | --- |
| Skills | CODEX_HOME/skills/<name> | PROJECT/.agents/skills/<name> |
| Native role TOMLs | CODEX_HOME/agents | PROJECT/.codex/agents |
| Runtime | CODEX_HOME/lonic/runtime | PROJECT/.codex/lonic/runtime |
| Operator configuration | CODEX_HOME/lonic/runtime-config.json | PROJECT/.codex/lonic/runtime-config.json |

The runtime selection ships runtime-config.example.json beside runtime. Copy it
to the global runtime-config.json as an explicit operator setup step and set
approved model/executable values. Project overrides accept only schema, model
and timeoutMs. Keep credentials outside both files. Install/update/removal
leave the actual operator runtime-config.json alone.

Identical target files are retained. Differing bytes refuse normal installation;
use the reviewed updater instead. Links/junctions refuse. The preview reports
same-name skills in the opposite scope for the selected project context (cwd by
default). Decide to remove one installation or explicitly --on-duplicate keep-both
to acknowledge coexistence; otherwise apply refuses. The other copy is never
overwritten. A global installer cannot enumerate every project on the machine.
Future project installations check their own context.

Install records the scope, canonical root, selection owners and SHA-256 of
each installed file in `lonic/install-receipt.json` under CODEX_HOME or
PROJECT/.codex. Update compares those records to the new package. Remove
uses the recorded files even when the newer package dropped them. A shared
file stays installed until its last owning selection is removed. Apply and
rollback include the receipt in the same reviewed transaction.

For a legacy installation, back up local edits and identify the original
package revision. Use the current installer with the original package files,
review --check and run --apply for each installed selection at that revision
to record matching files. Then restore the newer package and preview the update.

Installation copying is not a security boundary. Project trust remains a separate
Codex decision; the managed mode still requires exact-project trust. The ordinary
global skill listing observation below does not relax that managed requirement.

Check either scope with the same installer command plus --check (PowerShell
-Check), or bash bin/check-sync codex --skill powerup-auto [--scope project
--project PROJECT]. Exit 2 means drift or an unresolved preview collision; exit
1 is a usage/filesystem error. Check does not overwrite or decide coexistence.

### Native discovery evidence and limits

Windows Codex 0.167.0 zero-turn observations with a disposable HOME/CODEX_HOME:
user skills under CODEX_HOME/skills were listed without project trust; same-name
project and user skills were both enabled and returned (repo first). This is not
proof of a model-side winner. The separate HOME/.agents/skills fixture was not
listed; the installer does not use that location. CODEX_HOME/agents TOMLs were
discovered and parsed (a malformed role produced a named parse diagnostic), but
actual global role dispatch was not tested. config/read did not enumerate the
valid role. No login or model call was made for these observations.

A user-level tetel MCP registration loaded 14 tools without project trust in
that same Codex 0.167.0 test. Register it manually in CODEX_HOME/config.toml
(normally ~/.codex/config.toml), merging with existing settings:

```toml
[mcp_servers.tetel]
command = "tetel"
args = ["mcp"]
```

On Windows, command may instead be an absolute native executable path, for example
command = 'C:\tools\tetel.exe'. The installer does not add this registration.
Configuration discovery is not proof of a model invoking a tool. These are
versioned Windows observations; macOS has not been tested.

### Runtime lookup

Select PROJECT/.codex/lonic/runtime first, then CODEX_HOME/lonic/runtime. The
read-only helper resolve-installation.cjs in either installation accepts PROJECT
and queue or evidence and prints selected paths. Invoke the returned absolute
runtime path, quoting each argument separately. Queue entry-skill lookup also
prefers PROJECT/.agents/skills over CODEX_HOME/skills, and supplies that explicit
path to Codex. No project copy is needed for an ordinary globally installed run.

Project-first lookup is a trust boundary. A cloned repository can supply the
runtime JavaScript that executes and the entry skill whose instructions reach
Codex, even with a global installation. Review the project runtime and skills
before invoking them in an unfamiliar checkout.

Without --config, queue (--project) and evidence (--repo) read global
runtime-config.json, then accept only schema, model and timeoutMs from the
project layer. Any other project key stops lookup with an error naming the key
and file. Put executable names, command lists and run directories in the
operator-controlled global configuration or a deliberately selected standalone
--config file. Managed launch retains its own admission requirements.

Native test-filter-hook activation remains project-only; that selection refuses
global scope. A full global runtime contains inert hook files but does not enable
them. Follow the existing project hook/trust procedure; global activation was
not established here. Managed mode forbids any enabled native hook.

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
For this session only, use gpt-6.2-sol with low advisor effort.
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
install pult or dependencies. Select global or project scope; project scope requires an explicit path. codex-install
previews by default; its apply flag needs installation authorization.

Prepare changed package files with bin/manage-codex.cjs preview [--scope project --project PROJECT]
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

The `--managed` option selects the experimental B1 mode explicitly. It is experimental: narrow native observations cover enrollment, admission, handoff, cancellation, Node-substitute forced closure and ordinary reconcile; file work is unverified and command execution is not authorized, supported or observed. Ordinary calls are unchanged. Read [managed CLI, enrollment and limits](runtime/managed-cli.md) before selecting it: `--queue-kind file` and an explicit author timeout are mandatory; native hooks (including lonic's filter) are forbidden. Clean bounded work can return `incomplete` with preserved context. No native probe starts automatically.

For a global update, preview with node bin/manage-codex.cjs preview --skill
powerup-auto --plan PLAN_JSON; project updates add --scope project --project
PROJECT. For removal use remove instead of preview: it still only writes a plan,
and refuses edited target files. Apply and rollback use the saved scope/root and
exact --approved-sha256. Actual runtime-config.json and config.toml are outside
the plan's permitted targets. Preserve plans/receipts outside installed files.
