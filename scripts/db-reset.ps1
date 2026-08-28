#Requires -Version 5.1
<#
.SYNOPSIS
  public スキーマを削除して schema.sql / seed.sql を再適用する（全データ消去）。

.PARAMETER Yes
  確認プロンプトを省略する。

.EXAMPLE
  .\scripts\db-reset.ps1
  .\scripts\db-reset.ps1 -Yes
#>
param(
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_common.ps1")

Write-Host "[db-reset] PostgreSQL リセットを開始します"
$setupArgs = @("reset")
if ($Yes) {
    $setupArgs += "-y"
}
Invoke-DbSetup -DbSetupArgs $setupArgs
Write-Host "[db-reset] 完了"
