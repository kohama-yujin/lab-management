#Requires -Version 5.1
<#
.SYNOPSIS
  Lab Tools の VSIX をビルドし、管理者の意図的な実行で Slack DM 配布する。

.DESCRIPTION
  1. vscode-extension/lab-tools で vsce package
  2. 確認後、tools/notify_lab_tools_release.py で全メンバー DM に送信

  配置: 運用用 PowerShell は scripts/、Python 本体は tools/（db-init.ps1 と同じ分担）。

.PARAMETER SkipPackage
  VSIX 作成をスキップし、既存ファイルを通知だけする。

.PARAMETER SkipNotify
  パッケージのみ作成し、Slack 送信しない。

.PARAMETER DryRun
  Slack 送信先の確認のみ（実際には送らない）。

.PARAMETER Yes
  送信前の確認プロンプトを出さない。

.EXAMPLE
  .\scripts\release-lab-tools.ps1 -DryRun

.EXAMPLE
  .\scripts\release-lab-tools.ps1 -Yes
#>
param(
    [switch]$SkipPackage,
    [switch]$SkipNotify,
    [switch]$DryRun,
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_common.ps1")
$RepoRoot = Get-RepoRoot

$ExtDir = Join-Path $RepoRoot "vscode-extension\lab-tools"
$PackageJson = Join-Path $ExtDir "package.json"
$NotifyScript = Join-Path $RepoRoot "tools\notify_lab_tools_release.py"

if (-not (Test-Path -LiteralPath $PackageJson)) {
    throw ("package.json が見つかりません: {0}" -f $PackageJson)
}
if (-not (Test-Path -LiteralPath $NotifyScript)) {
    throw ("notify_lab_tools_release.py が見つかりません: {0}" -f $NotifyScript)
}

$pkg = Get-Content -LiteralPath $PackageJson -Raw -Encoding UTF8 | ConvertFrom-Json
$Version = [string]$pkg.version
if ([string]::IsNullOrWhiteSpace($Version)) {
    throw "package.json の version が空です"
}

$VsixName = "lab-tools-" + $Version + ".vsix"
$VsixPath = Join-Path $ExtDir $VsixName

Write-Host "Lab Tools release"
Write-Host ("  version : {0}" -f $Version)
Write-Host ("  vsix    : {0}" -f $VsixPath)

if (-not $SkipPackage) {
    Push-Location $ExtDir
    try {
        if (-not (Test-Path -LiteralPath (Join-Path $ExtDir "node_modules"))) {
            Write-Host "npm install ..."
            npm install
            if ($LASTEXITCODE -ne 0) { throw "npm install に失敗しました" }
        }

        Write-Host "vsce package ..."
        # repository 欠如を許容。LICENSE 確認プロンプトには y を送る。
        @("y", "y") | npx --yes @vscode/vsce package --allow-missing-repository
        if ($LASTEXITCODE -ne 0) {
            throw "vsce package に失敗しました"
        }
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath $VsixPath)) {
    throw ("VSIX が生成されていません: {0}" -f $VsixPath)
}

Write-Host ("  size    : {0:N0} bytes" -f (Get-Item -LiteralPath $VsixPath).Length)

if ($SkipNotify) {
    Write-Host "SkipNotify のため Slack 送信は行いません。"
    exit 0
}

$Python = Resolve-LabPython -RepoRoot $RepoRoot
$notifyArgs = @(
    $NotifyScript,
    "--vsix", $VsixPath,
    "--version", $Version
)
if ($DryRun) {
    $notifyArgs += "--dry-run"
}

if (-not $Yes -and -not $DryRun) {
    $prompt = "全メンバーの Slack DM に Lab Tools {0} を送りますか？ [y/N]" -f $Version
    $answer = Read-Host $prompt
    if ($answer -notmatch '^[yY]') {
        Write-Host "中止しました。"
        exit 0
    }
}

& $Python @notifyArgs
exit $LASTEXITCODE