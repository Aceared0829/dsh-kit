$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$bad = @()
Get-ChildItem $root -Recurse -File -Force | Where-Object {
  $_.FullName -notmatch '\\(\.git|node_modules)\\' -and $_.Name -ne 'sync.local.ps1' -and $_.Name -ne 'check-public.ps1'
} | ForEach-Object {
  $text = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
  if (-not $text) { return }
  if ($text -match 'C:\\Users\\|C:/Users/|D:\\deepseek|D:/deepseek|executablePath:') {
    $bad += $_.FullName.Substring($root.Length + 1)
  }
}
if ($bad.Count -gt 0) {
  Write-Error ("refusing public files with machine paths:`n" + ($bad -join "`n"))
}
Write-Output 'public check ok'
