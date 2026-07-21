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
    a single skill installs just that one and the agents it needs.

.PARAMETER Tool
    Which coding tool to install into (currently only "claude").

.PARAMETER Skill
    powerup | orchestrate | consult | design-doc | delivery | evolve
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('claude')]
    [string]$Tool,

    [Parameter(Mandatory = $true, Position = 1)]
    [ValidateSet('powerup', 'orchestrate', 'consult', 'design-doc', 'delivery', 'evolve')]
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
    }
}

# --- Which skills + agents does this selection pull in? ---------------------
switch ($Skill) {
    'powerup' {
        $skills = @('powerup', 'orchestrate', 'consult', 'design-doc', 'delivery', 'evolve')
        $agents = @('lonic-exec-medium', 'lonic-exec-high', 'lonic-exec-xhigh',
                    'lonic-advisor-medium', 'lonic-advisor-high', 'lonic-advisor-xhigh')
    }
    'orchestrate' {
        $skills = @('orchestrate')
        $agents = @('lonic-exec-medium', 'lonic-exec-high', 'lonic-exec-xhigh')
    }
    'consult' {
        $skills = @('consult')
        $agents = @('lonic-advisor-medium', 'lonic-advisor-high', 'lonic-advisor-xhigh')
    }
    default {
        # design-doc | delivery | evolve — skill only, no agents
        $skills = @($Skill)
        $agents = @()
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

Write-Host ''
Write-Host "Installed '$Skill' for $Tool."
if ($Skill -eq 'powerup') {
    Write-Host 'Start a session and run /powerup to switch on full-rigor mode.'
} else {
    Write-Host "Start a session and enable it by name: /$Skill"
}
