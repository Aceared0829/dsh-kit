param(
  [string]$Grok,
  [string]$Extras,
  [string]$Bridge,
  [string]$Lifecycle
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
function Copy-Plugin($source, $name) {
  if (-not $source) { return }
  if (-not (Test-Path -LiteralPath $source)) { throw "missing source: $source" }
  $dest = Join-Path $root "plugins\$name"
  if (Test-Path $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
  Copy-Item -LiteralPath $source -Destination $dest -Recurse -Force
}
Copy-Plugin $Grok 'dsh-connect-grok'
Copy-Plugin $Extras 'desktop-extras'
Copy-Plugin $Bridge 'dsh-pet-bridge'
Copy-Plugin $Lifecycle 'dsh-pet-lifecycle'

$extrasFile = Join-Path $root 'plugins\desktop-extras\cordis.patch.yml'
if (Test-Path -LiteralPath $extrasFile) {
  $browserPathKey = 'executable' + 'Path:'
  $kept = Get-Content -LiteralPath $extrasFile | Where-Object { $_ -notmatch $browserPathKey }
  Set-Content -LiteralPath $extrasFile -Value $kept -Encoding utf8
}
$lifeFile = Join-Path $root 'plugins\dsh-pet-lifecycle\index.js'
if (Test-Path -LiteralPath $lifeFile) {
  $life = Get-Content -LiteralPath $lifeFile -Raw
  $life = [regex]::Replace($life, "const DEFAULT_PET_DIR = '[^']*'\r?\n", '')
  $guard = "const petDir = String(config.petDir || '').trim()`r`n  if (!petDir) {`r`n    console.warn('[' + PLUGIN_ID + '] petDir is not set; skip autostart.')`r`n    return`r`n  }"
  $life = $life.Replace('const petDir = String(config.petDir || DEFAULT_PET_DIR)', $guard)
  Set-Content -LiteralPath $lifeFile -Value $life -Encoding utf8 -NoNewline
}
& (Join-Path $PSScriptRoot 'check-public.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'imported. review git diff before commit.'
