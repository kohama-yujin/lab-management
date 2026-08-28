#Requires -Version 5.1
<#
.SYNOPSIS
  PostgreSQL データベースを作成し、schema.sql / seed.sql を適用する。

.DESCRIPTION
  DATABASE_URL は .env または環境変数から読み込む（Python 側で処理）。
  PostgreSQL 本体のインストールは docs/postgresql-setup.md を参照。

.EXAMPLE
  Copy-Item .env.example .env
  # .env の DATABASE_URL を編集
  .\scripts\db-init.ps1
#>
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "_common.ps1")

Write-Host "[db-init] PostgreSQL 初期化を開始します"
Invoke-DbSetup -DbSetupArgs @("init")
Write-Host "[db-init] 完了"
