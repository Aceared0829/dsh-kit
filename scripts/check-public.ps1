$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

# Machine-specific paths that must never reach a public file.
#   C:\Users\<name>  a real Windows profile directory. Redacted examples
#                    (`C:\Users\<you>`, `C:\Users\...`) are allowed on purpose:
#                    documentation needs them and they name nobody.
#   D:\deepseek-harness  the author's checkout; a reader's checkout differs.
#   executablePath: value  a browser binary hardcoded into a plugin config.
#   $env:USERNAME        catches the author's own account name anywhere.
$machine = 'C:[\\/]Users[\\/](?!<|\.\.\.)[^\\/\s"'']+|D:[\\/]deepseek|executablePath\s*:\s*[^$]|\bUSERPROFILE\s*=\s*C:'

$bad = @()
Get-ChildItem $root -Recurse -File -Force | Where-Object {
  $_.FullName -notmatch '\\(\.git|node_modules)\\' -and $_.Name -ne 'sync.local.ps1' -and $_.Name -ne 'check-public.ps1'
} | ForEach-Object {
  $text = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
  if (-not $text) { return }
  if ($text -match $machine) {
    $line = ($text -split "`n" | Select-String -Pattern $machine | Select-Object -First 1).Line.Trim()
    $bad += ($_.FullName.Substring($root.Length + 1) + '  ->  ' + $line)
  }
}
if ($bad.Count -gt 0) {
  Write-Error ("refusing public files with machine paths:`n" + ($bad -join "`n"))
}
Write-Output 'public check ok'
