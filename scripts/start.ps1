#Requires -Version 5.1
<#
.SYNOPSIS
  在室管理 (FastAPI) と Cloudflare Quick Tunnel を起動し、公開 URL を data/tunnel_url.txt に保存する。

.NOTES
  タスクスケジューラからは次のように実行する:
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "...\scripts\start.ps1"

  data/ に書き込むのは tunnel_url.txt のみ。
  PID や起動時の一時ログは %TEMP%\lab-management\ に置く。

  Python の探索順:
    1. venv\Scripts\python.exe
    2. wifi_env\Scripts\python.exe
    3. .venv\Scripts\python.exe
    4. PATH 上の python（WindowsApps スタブは除外）

  cloudflared の場所（優先順）:
    1. 環境変数 CLOUDFLARED_EXE
    2. リポジトリの tools\cloudflared-windows-amd64.exe
    3. %USERPROFILE%\Downloads\cloudflared-windows-amd64.exe
#>
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DataDir = Join-Path $RepoRoot "data"
$StateDir = Join-Path $env:TEMP "lab-management"
$TunnelUrlFile = Join-Path $DataDir "tunnel_url.txt"
$CloudflaredOutLog = Join-Path $StateDir "cloudflared.out.log"
$CloudflaredErrLog = Join-Path $StateDir "cloudflared.err.log"
$AppPidFile = Join-Path $StateDir "app.pid"
$TunnelPidFile = Join-Path $StateDir "cloudflared.pid"
$AppOutLog = Join-Path $StateDir "app.out.log"
$AppErrLog = Join-Path $StateDir "app.err.log"
$Port = 5000
$OriginUrl = "http://127.0.0.1:$Port"

New-Item -ItemType Directory -Force -Path $DataDir, $StateDir | Out-Null

function Write-Info([string]$Message) {
    Write-Host "[start] $Message"
}

function Write-StartError([string]$Message) {
    Write-Host "[start] ERROR: $Message"
}

function Remove-TempLogFiles {
    Remove-Item -LiteralPath $CloudflaredOutLog, $CloudflaredErrLog, $AppOutLog, $AppErrLog -Force -ErrorAction SilentlyContinue
}

function Read-TailLines([string]$Path, [int]$Count = 20) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return @()
    }
    return @(Get-Content -LiteralPath $Path -Tail $Count -ErrorAction SilentlyContinue)
}

function Resolve-Cloudflared {
    if ($env:CLOUDFLARED_EXE -and (Test-Path -LiteralPath $env:CLOUDFLARED_EXE)) {
        return (Resolve-Path -LiteralPath $env:CLOUDFLARED_EXE).Path
    }
    $candidates = @(
        (Join-Path $RepoRoot "tools\cloudflared-windows-amd64.exe"),
        (Join-Path $env:USERPROFILE "Downloads\cloudflared-windows-amd64.exe")
    )
    foreach ($path in $candidates) {
        if (Test-Path -LiteralPath $path) {
            return (Resolve-Path -LiteralPath $path).Path
        }
    }
    throw "cloudflared が見つかりません。tools\ に置くか CLOUDFLARED_EXE を設定してください。"
}

function Resolve-Python {
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

    # タスクスケジューラでは PATH が狭い。WindowsApps の python スタブは使わない。
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if (
        $cmd -and
        $cmd.Source -and
        (Test-Path -LiteralPath $cmd.Source) -and
        ($cmd.Source -notmatch '(?i)\\WindowsApps\\')
    ) {
        return $cmd.Source
    }

    throw "Python が見つかりません。venv または wifi_env を作成し、pip install -r requirements.txt してください。"
}

function Test-PortOpen([int]$PortNumber) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $async = $client.BeginConnect("127.0.0.1", $PortNumber, $null, $null)
        $ok = $async.AsyncWaitHandle.WaitOne(400)
        if ($ok -and $client.Connected) {
            $client.EndConnect($async) | Out-Null
            $client.Close()
            return $true
        }
        $client.Close()
    } catch {
        # ignore
    }
    return $false
}

function Stop-PidFromFile([string]$PidFile, [string]$Label) {
    if (-not (Test-Path -LiteralPath $PidFile)) {
        return
    }
    $raw = (Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $raw) {
        return
    }
    $procId = 0
    if (-not [int]::TryParse($raw.Trim(), [ref]$procId)) {
        return
    }
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Info "既存の $Label (PID $procId) を停止します"
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

function Find-TunnelUrl {
    $pattern = 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'
    foreach ($logPath in @($CloudflaredOutLog, $CloudflaredErrLog)) {
        if (-not (Test-Path -LiteralPath $logPath)) {
            continue
        }
        $match = Select-String -Path $logPath -Pattern $pattern -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($match -and $match.Matches.Count -gt 0) {
            return $match.Matches[0].Value
        }
    }
    return $null
}

try {
    Write-Info "==== start.ps1 begin ===="
    Write-Info "repo: $RepoRoot"

    # 前回の残骸を掃除
    Stop-PidFromFile -PidFile $TunnelPidFile -Label "cloudflared"
    Stop-PidFromFile -PidFile $AppPidFile -Label "app"
    Remove-Item -LiteralPath $TunnelUrlFile -Force -ErrorAction SilentlyContinue
    Remove-TempLogFiles

    $Python = Resolve-Python
    $Cloudflared = Resolve-Cloudflared
    Write-Info "python: $Python"
    Write-Info "cloudflared: $Cloudflared"

    if (Test-PortOpen -PortNumber $Port) {
        Write-Info "ポート $Port は既に使用中です。既存プロセスを利用します。"
    } else {
        Write-Info "在室管理を起動します"
        $app = Start-Process -FilePath $Python `
            -ArgumentList "main.py" `
            -WorkingDirectory $RepoRoot `
            -RedirectStandardOutput $AppOutLog `
            -RedirectStandardError $AppErrLog `
            -WindowStyle Hidden `
            -PassThru
        Set-Content -LiteralPath $AppPidFile -Value $app.Id -Encoding ascii

        $ready = $false
        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Seconds 1
            if (Test-PortOpen -PortNumber $Port) {
                $ready = $true
                break
            }
            if ($app.HasExited) {
                $tail = Read-TailLines -Path $AppErrLog
                if ($tail.Count -gt 0) {
                    Write-StartError ($tail -join [Environment]::NewLine)
                }
                throw "在室管理の起動に失敗しました。プロセスが終了しています。"
            }
        }
        if (-not $ready) {
            throw "在室管理がポート $Port で応答しません。"
        }
        Write-Info "在室管理が起動しました (PID $($app.Id))"
        Remove-Item -LiteralPath $AppOutLog, $AppErrLog -Force -ErrorAction SilentlyContinue
    }

    Write-Info "cloudflared Quick Tunnel を起動します"
    $cfArgs = @("tunnel", "--url", $OriginUrl)
    $cf = Start-Process -FilePath $Cloudflared `
        -ArgumentList $cfArgs `
        -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput $CloudflaredOutLog `
        -RedirectStandardError $CloudflaredErrLog `
        -WindowStyle Hidden `
        -PassThru
    Set-Content -LiteralPath $TunnelPidFile -Value $cf.Id -Encoding ascii

    $url = $null
    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep -Seconds 1
        if ($cf.HasExited) {
            $tail = Read-TailLines -Path $CloudflaredErrLog
            if ($tail.Count -gt 0) {
                Write-StartError ($tail -join [Environment]::NewLine)
            }
            throw "cloudflared が終了しました。"
        }
        $url = Find-TunnelUrl
        if ($url) {
            break
        }
    }

    if (-not $url) {
        throw "Quick Tunnel URL を取得できませんでした。"
    }

    Remove-TempLogFiles

    # PowerShell 5.1 の utf8 は BOM 付きなので、BOM なし UTF-8 で書く
    [System.IO.File]::WriteAllText($TunnelUrlFile, $url + [Environment]::NewLine)
    Write-Info "公開 URL: $url"
    Write-Info "完了（プロセスは常駐します）"
    Write-Info "==== start.ps1 end ===="
    exit 0
} catch {
    Write-StartError $_.Exception.Message
    Write-Info "==== start.ps1 failed ===="
    exit 1
}
