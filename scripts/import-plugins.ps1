# 把本机正在用的本地插件复制进本库。仅本地用，不提交。
#
# 用法（在仓库根目录）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\import-plugins.ps1 `
#     -Grok      <dsh-connect-grok 源码目录> `
#     -Extras    <desktop-extras 源码目录> `
#     -Viewer    <dsh-image-viewer 源码目录> `
#     -Workbuddy <dsh-connect-workbuddy 源码目录> `
#     -Eval      <harness-eval 源码目录> `
#     -Turn      <dsh-turn-autocontinue 源码目录>
#
# 只传你要同步的那几个；没传的保持仓库里现有内容不动。
# 考研工作台不在这套同步里。
param(
  [string]$Grok,
  [string]$Extras,
  [string]$Viewer,
  [string]$Workbuddy,
  [string]$Eval,
  [string]$Turn
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

# 目录名 -> 目标目录
$targets = [ordered]@{
  Grok      = 'dsh-connect-grok'
  Extras    = 'desktop-extras'
  Viewer    = 'dsh-image-viewer'
  Workbuddy = 'dsh-connect-workbuddy'
  Eval      = 'harness-eval'
  Turn      = 'dsh-turn-autocontinue'
}

# workbuddy 自带一份 schemastery，profile 根上没有这个包，必须一起复制。
$keepNodeModules = @{ 'dsh-connect-workbuddy' = $true }

function Copy-Plugin([string]$source, [string]$name) {
  if (-not $source) { return }
  if (-not (Test-Path -LiteralPath $source)) { throw "missing source: $source" }
  $dest = Join-Path $root "plugins\$name"
  if (Test-Path -LiteralPath $dest) {
    # 保留 node_modules（可能是 junction），其余删掉重来，避免留下已删除的文件。
    $nm = Join-Path $dest 'node_modules'
    $stash = $null
    if ((Test-Path -LiteralPath $nm) -and -not $keepNodeModules[$name]) {
      $stash = Join-Path $env:TEMP ("dsh-kit-nm-" + [guid]::NewGuid().ToString('N'))
      Move-Item -LiteralPath $nm -Destination $stash -Force
    }
    Get-ChildItem -LiteralPath $dest -Force | Where-Object { $_.Name -ne 'node_modules' } |
      Remove-Item -Recurse -Force
    robocopy $source $dest /E /NFL /NDL /NJH /NJS /NP /XD node_modules .git | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE): $source -> $dest" }
    if ($stash) { Move-Item -LiteralPath $stash -Destination $nm -Force }
  } else {
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    robocopy $source $dest /E /NFL /NDL /NJH /NJS /NP /XD node_modules .git | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE): $source -> $dest" }
  }
  Write-Output "imported $name"
}

foreach ($key in $targets.Keys) {
  Copy-Plugin (Get-Variable -Name $key -ValueOnly) $targets[$key]
}

# desktop-extras 的浏览器路径属于本机配置，不进仓库。
$extrasFile = Join-Path $root 'plugins\desktop-extras\cordis.patch.yml'
if (Test-Path -LiteralPath $extrasFile) {
  $browserPathKey = 'executable' + 'Path:'
  $kept = Get-Content -LiteralPath $extrasFile | Where-Object { $_ -notmatch $browserPathKey }
  Set-Content -LiteralPath $extrasFile -Value $kept -Encoding utf8
}

# 续跑插件的说明里如果带了本机 link，换成库内占位，避免公开检查失败。
$turnReadme = Join-Path $root 'plugins\dsh-turn-autocontinue\README.md'
if (Test-Path -LiteralPath $turnReadme) {
  $turnText = Get-Content -LiteralPath $turnReadme -Raw
  $turnNext = $turnText
  $turnNext = $turnNext -replace 'link:C:[\\/]Users[\\/][^\s"'']+', 'link:<本库路径>/plugins/dsh-turn-autocontinue'
  $turnNext = $turnNext -replace 'D:[\\/]deepseek-harness', '<你的 DSH 检出>'
  if ($turnNext -ne $turnText) {
    Set-Content -LiteralPath $turnReadme -Value $turnNext -Encoding utf8 -NoNewline
    Write-Output 'sanitized dsh-turn-autocontinue README'
  }
}

& (Join-Path $PSScriptRoot 'check-public.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'imported. review git diff before commit.'
