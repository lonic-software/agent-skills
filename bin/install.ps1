<#
.SYNOPSIS
    Install a powerup skill (and the agents it needs) into a coding tool's config.

.DESCRIPTION
    PowerShell fallback for Windows machines without Git Bash. Feature-parity
    with bin/install (bash). Because pult runs `run:` via `sh -c`, pult itself
    needs Git Bash on Windows; run this script directly when you don't have it:

        powershell -ExecutionPolicy Bypass -File bin\install.ps1 claude powerup
        pwsh bin/install.ps1 claude powerup

    "powerup" installs the whole bundle (all five skills + their agents);
    "powerup-auto" is that bundle plus queue-run and its wrapper; a single
    skill installs just that one and the agents it needs. "test-filter-hook"
    copies the hook scripts and prints the settings.json entry to add.

.PARAMETER Tool
    Which coding tool to install into (currently only "claude").

.PARAMETER Skill
    powerup | consult | design-doc | delivery | evolve | queue-run
    | powerup-auto | test-filter-hook
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('claude')]
    [string]$Tool,

    [Parameter(Mandatory = $true, Position = 1)]
    [ValidateSet('powerup', 'consult', 'design-doc', 'delivery', 'evolve', 'queue-run',
                 'powerup-auto', 'test-filter-hook')]
    [string]$Skill
)

$ErrorActionPreference = 'Stop'

# pult calls the bash sibling; run directly, the repo root is this script's parent.
$repoRoot = Split-Path -Parent $PSScriptRoot

# --- Per-tool config layout -------------------------------------------------
switch ($Tool) {
    'claude' {
        # Nested Join-Path (not 'a\b' literals) so paths are separator-agnostic
        # across Windows PowerShell 5.1 and cross-platform pwsh.
        $srcSkills = Join-Path (Join-Path $repoRoot 'claude') 'skills'
        $srcAgents = Join-Path (Join-Path $repoRoot 'claude') 'agents'
        $dstSkills = Join-Path (Join-Path $HOME '.claude') 'skills'
        $dstAgents = Join-Path (Join-Path $HOME '.claude') 'agents'
        $srcHooks  = Join-Path (Join-Path $repoRoot 'claude') 'hooks'
        $dstHooks  = Join-Path (Join-Path $HOME '.claude') 'hooks'
    }
}

# --- Which skills + agents does this selection pull in? ---------------------
# Hooks are copied but never wired in: settings.json is the user's, so the
# entry to add is printed instead.
$advisors     = @('lonic-advisor-low', 'lonic-advisor-medium', 'lonic-advisor-high', 'lonic-advisor-xhigh')
# Inert without tetel; design-doc routes to them only when it is installed.
$designPasses = @('lonic-design-attacker', 'lonic-grounder')
$bundleSkills = @('powerup', 'consult', 'design-doc', 'delivery', 'evolve')
$skills = @(); $agents = @(); $hooks = @()
switch ($Skill) {
    'powerup' {
        $skills = $bundleSkills
        $agents = $advisors + $designPasses
    }
    'powerup-auto' {
        $skills = $bundleSkills + @('queue-run', 'powerup-auto')
        $agents = $advisors + $designPasses
    }
    'consult' {
        $skills = @('consult')
        $agents = $advisors
    }
    'design-doc' {
        $skills = @('design-doc')
        $agents = $designPasses
    }
    'test-filter-hook' {
        $hooks = @('filter-test-output.sh', 'test-output-summary.sh')
    }
    default {
        # delivery | evolve | queue-run — skill only
        $skills = @($Skill)
    }
}

# --- Copy -------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $dstSkills, $dstAgents | Out-Null

foreach ($s in $skills) {
    $from = Join-Path $srcSkills $s
    if (-not (Test-Path -LiteralPath $from -PathType Container)) {
        throw "install: skill '$s' not found at $from"
    }
    $to = Join-Path $dstSkills $s
    if (Test-Path -LiteralPath $to) { Remove-Item -LiteralPath $to -Recurse -Force }
    Copy-Item -LiteralPath $from -Destination $to -Recurse -Force
    Write-Host "  skill  $s -> $to"
}

foreach ($a in $agents) {
    $from = Join-Path $srcAgents "$a.md"
    if (-not (Test-Path -LiteralPath $from -PathType Leaf)) {
        throw "install: agent '$a' not found at $from"
    }
    $to = Join-Path $dstAgents "$a.md"
    Copy-Item -LiteralPath $from -Destination $to -Force
    Write-Host "  agent  $a -> $to"
}

# Hook scripts are bash; on Windows they run under Git Bash.
foreach ($n in $hooks) {
    $from = Join-Path $srcHooks $n
    if (-not (Test-Path -LiteralPath $from -PathType Leaf)) {
        throw "install: hook '$n' not found at $from"
    }
    New-Item -ItemType Directory -Force -Path $dstHooks | Out-Null
    $to = Join-Path $dstHooks $n
    Copy-Item -LiteralPath $from -Destination $to -Force
    Write-Host "  hook   $n -> $to"
}

Write-Host ''
Write-Host "Installed '$Skill' for $Tool."
if ($Skill -eq 'powerup') {
    Write-Host 'Start a session and run /powerup to switch on full-rigor mode.'
} elseif ($Skill -eq 'test-filter-hook') {
    $hookCmd = 'bash ' + ((Join-Path $dstHooks 'filter-test-output.sh') -replace '\\', '/')
    Write-Host 'Not active yet: add this to ~/.claude/settings.json (needs jq and Git Bash):'
    Write-Host ''
    Write-Host '  "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": ['
    Write-Host "    { `"type`": `"command`", `"command`": `"$hookCmd`" }"
    Write-Host '  ] } ] }'
} elseif ($Skill -eq 'queue-run' -or $Skill -eq 'powerup-auto') {
    Write-Host "Start a session and run /$Skill stop at <N>%."
    Write-Host 'It hands off between items with the phase-handoff mod (see README, "Mods");'
    Write-Host "without it, each session stops and prints the next session's prompt."
} else {
    Write-Host "Start a session and enable it by name: /$Skill"
}
