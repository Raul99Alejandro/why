# Unattended Bee sync for Why (PowerShell 5.1 compatible).
# Runs `src/cli/sync.ts` with the why-sync AWS profile and appends one line per run to
# %LOCALAPPDATA%\why\sync.log: timestamp + counts JSON, or "error: <class or exit code>".
# Conversation text is never logged: only the counts line or an error class name.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $env:LOCALAPPDATA 'why'
$logFile = Join-Path $logDir 'sync.log'
$maxLines = 500
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-SyncLog([string]$message) {
  $line = '{0} {1}' -f (Get-Date).ToString('o'), $message
  Add-Content -Path $logFile -Value $line -Encoding UTF8
  $all = @(Get-Content -Path $logFile -Encoding UTF8)
  if ($all.Count -gt $maxLines) {
    $all | Select-Object -Last $maxLines | Set-Content -Path $logFile -Encoding UTF8
  }
}

# Per-run stderr file; stale ones from killed runs are removed first.
Get-ChildItem -Path $logDir -Filter '*.err.tmp' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
$errFile = Join-Path $logDir ('sync-{0}.err.tmp' -f [guid]::NewGuid().ToString('N'))

# True only for a flat JSON object whose values are numbers or arrays of YYYY-MM-DD strings.
function Test-CountsJson([string]$text) {
  try { $obj = $text | ConvertFrom-Json } catch { return $false }
  if ($null -eq $obj -or $obj -isnot [System.Management.Automation.PSCustomObject]) { return $false }
  $props = @($obj.PSObject.Properties)
  if ($props.Count -eq 0) { return $false }
  foreach ($p in $props) {
    $v = $p.Value
    if ($v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [decimal]) { continue }
    if ($v -is [System.Array]) {
      foreach ($item in $v) {
        if ($item -isnot [string] -or $item -notmatch '^\d{4}-\d{2}-\d{2}$') { return $false }
      }
      continue
    }
    return $false
  }
  return $true
}
try {
  $env:AWS_PROFILE = 'why-sync'
  $env:AWS_REGION = 'us-east-1'
  if (-not $env:TABLE) {
    $outputs = Get-Content -Raw -Path (Join-Path $repo 'cdk-outputs.local.json') | ConvertFrom-Json
    $env:TABLE = $outputs.Why.TableName
  }
  if (-not $env:TABLE) { throw 'TableName not found in cdk-outputs.local.json' }
  Set-Location $repo

  $ErrorActionPreference = 'Continue'
  $stdout = & node --import tsx src/cli/sync.ts 2> $errFile
  $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'

  if ($code -ne 0) {
    # Only the class name on the first non-empty stderr line is kept, never its text.
    $name = 'unknown'
    if (Test-Path $errFile) {
      $first = Get-Content -Path $errFile | Where-Object { $_.Trim() } | Select-Object -First 1
      $m = [regex]::Match([string]$first, '^\s*([A-Za-z]+(Error|Exception))\b')
      if ($m.Success) { $name = $m.Groups[1].Value }
    }
    Write-SyncLog ('error: ' + $name)
    exit 1
  }
  $counts = ([string](@($stdout) | Select-Object -Last 1)).Trim()
  if (Test-CountsJson $counts) { Write-SyncLog $counts } else { Write-SyncLog 'ok (unparsed output)' }
  exit 0
} catch {
  # Exception type only: the message could carry paths or data.
  Write-SyncLog ('error: ' + $_.Exception.GetType().Name)
  exit 1
} finally {
  if (Test-Path $errFile) { Remove-Item -Force $errFile -ErrorAction SilentlyContinue }
}
