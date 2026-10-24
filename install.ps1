param(
  [string]$Profile,
  [string]$DshPath,
  # Not $Home: that name collides with PowerShell's read-only automatic variable,
  # and binding it fails before the script body runs. -Home remains a hidden alias.
  [Alias('Home')][string]$HarnessHome,
  [switch]$DryRun,
  [switch]$SkipPreferences,
  [switch]$SkipShipped
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here 'scripts\install.mjs'
$forward = @()
if ($Profile) { $forward += @('--profile', $Profile) }
if ($DshPath) { $forward += @('--dsh', $DshPath) }
if ($HarnessHome) { $forward += @('--home', $HarnessHome) }
if ($DryRun) { $forward += '--dry-run' }
if ($SkipPreferences) { $forward += '--skip-preferences' }
if ($SkipShipped) { $forward += '--skip-shipped' }

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  & $node.Source $script @forward
  exit $LASTEXITCODE
}
$electron = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'
if (Test-Path $electron) {
  $env:ELECTRON_RUN_AS_NODE = '1'
  & $electron --expose-internals $script @forward
  exit $LASTEXITCODE
}
Write-Error 'node was not found, and DeepSeek Harness.exe was not found.'
exit 1
