param([Parameter(Mandatory=$true)][string]$GatePath)
$ErrorActionPreference = 'Stop'
$stream = $null
$owner = $null
$locked = $false
try {
  # Launch stdin must provide the registered intent, original owner identity and
  # existing gate nonce. Nothing is created, replaced or recovered automatically.
  $request = [Console]::In.ReadLine() | ConvertFrom-Json
  if (-not $request.intentId -or -not $request.nonce -or $request.ownerPid -le 0) { throw 'Invalid intent' }
  $owner = [Diagnostics.Process]::GetProcessById([int]$request.ownerPid)
  $null = $owner.Handle
  $observed = Get-CimInstance Win32_Process -Filter "ProcessId = $($request.ownerPid)" -OperationTimeoutSec 1
  if ($null -eq $observed -or $observed.CreationDate.ToUniversalTime().Ticks.ToString() -ne $request.ownerCreated -or $owner.HasExited) { throw 'Owner changed' }
  # ReadWrite sharing deliberately excludes Delete. Use exactly the FileStream
  # lock family for this Windows cooperative gate; no Job Object or Add-Type.
  $stream = [IO.FileStream]::new($GatePath,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)
  $stream.Lock(0,1)
  $locked = $true
  if ($stream.Length -gt 4096) { throw 'Gate too large' }
  $bytes = New-Object byte[] ([int]$stream.Length)
  $read = $stream.Read($bytes,0,$bytes.Length)
  if ($read -ne $bytes.Length -or [Text.Encoding]::UTF8.GetString($bytes) -cne $request.nonce) { throw 'Gate changed' }
  @{event='locked';intentId=$request.intentId} | ConvertTo-Json -Compress
  $pendingLine = [Console]::In.ReadLineAsync()
  while (-not $owner.HasExited) {
    if ($pendingLine.Wait(200)) {
      $line = $pendingLine.Result
      if ($null -eq $line -or $line -eq 'release') { break }
      if ($line -ne 'ping') { throw 'Invalid command' }
      @{event='held';intentId=$request.intentId} | ConvertTo-Json -Compress
      $pendingLine = [Console]::In.ReadLineAsync()
    }
  }
} catch {
  [Console]::Error.WriteLine('GATE_HELPER_FAILED')
  exit 1
} finally {
  if ($null -ne $stream) { if ($locked) { $stream.Unlock(0,1) }; $stream.Dispose() }
  if ($null -ne $owner) { $owner.Dispose() }
}
