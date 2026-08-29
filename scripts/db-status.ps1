#Requires -Version 5.1
<#
.SYNOPSIS
  DATABASE_URL への接続とテーブル件数を表示する。

.EXAMPLE
  .\scripts\db-status.ps1
#>
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_common.ps1")

Invoke-DbSetup -DbSetupArgs @("status")
