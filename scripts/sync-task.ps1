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

$errFile = Join-Path $logDir 'sync.err.tmp'
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
    # Only an exception class name (e.g. ExpiredTokenException) is kept from stderr, never its text.
    $err = ''
    if (Test-Path $errFile) { $err = (Get-Content -Raw -Path $errFile) }
    $name = [regex]::Match([string]$err, '\b[A-Za-z]+(Error|Exception)\b').Value
    if (-not $name) { $name = 'exit code ' + $code }
    Write-SyncLog ('error: ' + $name)
    exit 1
  }
  $counts = ([string](@($stdout) | Select-Object -Last 1)).Trim()
  Write-SyncLog $counts
  exit 0
} catch {
  # Exception type only: the message could carry paths or data.
  Write-SyncLog ('error: ' + $_.Exception.GetType().Name)
  exit 1
} finally {
  if (Test-Path $errFile) { Remove-Item -Force $errFile -ErrorAction SilentlyContinue }
}
