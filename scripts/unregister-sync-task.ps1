# Removes the "Why Bee sync" scheduled task (PowerShell 5.1 compatible).
$ErrorActionPreference = 'Stop'
if (Get-ScheduledTask -TaskName 'Why Bee sync' -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName 'Why Bee sync' -Confirm:$false
  Write-Host "Removed 'Why Bee sync'."
} else {
  Write-Host "'Why Bee sync' is not registered."
}
