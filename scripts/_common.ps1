#Requires -Version 5.1
<#
.SYNOPSIS
  db 系スクリプト共通のヘルパー。
#>

function Get-RepoRoot {
    return (Split-Path -Parent $PSScriptRoot)
}

function Resolve-LabPython {
    param(
        [string]$RepoRoot = (Get-RepoRoot)
    )

    $candidates = @(
        (Join-Path $RepoRoot "venv\Scripts\python.exe"),
        (Join-Path $RepoRoot "wifi_env\Scripts\python.exe"),
        (Join-Path $RepoRoot ".venv\Scripts\python.exe")
    )
    foreach ($path in $candidates) {
        if (Test-Path -LiteralPath $path) {
            return (Resolve-Path -LiteralPath $path).Path
        }
    }

    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if (
        $cmd -and
        $cmd.Source -and
        (Test-Path -LiteralPath $cmd.Source) -and
        ($cmd.Source -notmatch '(?i)\\WindowsApps\\')
    ) {
        return $cmd.Source
    }

    throw "Python が見つかりません。venv を作成し pip install -r requirements.txt してください。"
}

function Invoke-DbSetup {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$DbSetupArgs
    )

    $RepoRoot = Get-RepoRoot
    $Python = Resolve-LabPython
    $Script = Join-Path $RepoRoot "tools\db_setup.py"

    if (-not (Test-Path -LiteralPath $Script)) {
        throw "db_setup.py が見つかりません: $Script"
    }

    & $Python $Script @DbSetupArgs
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
