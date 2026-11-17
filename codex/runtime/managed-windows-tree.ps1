param(
  [ValidateSet('observe','signal')][string]$Action,
  [int]$TargetId = 0,
  [int]$ParentId = 0,
  [string]$Created = ''
)
$ErrorActionPreference = 'Stop'
# best-effort observed tree cleanup, not proof of containment
function Record-Process($Entry) {
  @{pid=[int]$Entry.ProcessId; parentPid=[int]$Entry.ParentProcessId;
    created=if ($null -ne $Entry.CreationDate) { $Entry.CreationDate.ToUniversalTime().Ticks.ToString() } else { '' }}
}
try {
  if ($Action -eq 'observe') {
    $rows = @(Get-CimInstance Win32_Process -OperationTimeoutSec 1 | ForEach-Object { Record-Process $_ })
    @{complete=$true; processes=$rows} | ConvertTo-Json -Depth 4 -Compress
    exit 0
  }
  if ($TargetId -le 0 -or $Created -notmatch '^\d+$') { throw 'Invalid identity' }
  $entry = Get-CimInstance Win32_Process -Filter "ProcessId = $TargetId" -OperationTimeoutSec 1
  if ($null -eq $entry) { @{verified=$true;status='gone'} | ConvertTo-Json -Compress; exit 0 }
  $row = Record-Process $entry
  if ($row.created -ne $Created -or $row.parentPid -ne $ParentId) { throw 'Identity changed' }
  $targetProcess = [Diagnostics.Process]::GetProcessById($TargetId)
  try {
    # Retain the OS process handle before the second identity observation.
    $null = $targetProcess.Handle
    # CIM timestamps have microsecond precision; compare the retained handle's
    # own start time at that precision before trusting a PID-indexed query.
    $handleCreated = $targetProcess.StartTime.ToUniversalTime().Ticks.ToString()
    if ($Created.Length -lt 2 -or $handleCreated.Substring(0,$handleCreated.Length-1) -cne $Created.Substring(0,$Created.Length-1)) { throw 'Handle identity changed' }
    $again = Get-CimInstance Win32_Process -Filter "ProcessId = $TargetId" -OperationTimeoutSec 1
    if ($null -eq $again) { @{verified=$true;status='gone'} | ConvertTo-Json -Compress; exit 0 }
    $checked = Record-Process $again
    if ($checked.created -ne $Created -or $checked.parentPid -ne $ParentId -or $targetProcess.HasExited) { throw 'Identity changed' }
    $targetProcess.Kill()
    @{verified=$true;status='signalled'} | ConvertTo-Json -Compress
  } finally { $targetProcess.Dispose() }
} catch {
  # Do not emit process command lines, environment, paths or native exception data.
  [Console]::Error.WriteLine('PROCESS_OBSERVATION_FAILED')
  exit 1
}
