# cloudflared（Cloudflare Quick Tunnel）セットアップ手順

lab-management は、ローカルで動く FastAPI（既定ポート `5000`）をインターネットから到達可能にするため、**cloudflared** の **Quick Tunnel**（`*.trycloudflare.com`）を使います。

このドキュメントでは **バイナリの入手・配置（手作業）** と **リポジトリ付属スクリプト（自動）** の役割分担を説明します。

公式ドキュメント:

- [Downloads · Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)
- [Quick Tunnels（TryCloudflare）](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
- [GitHub Releases · cloudflare/cloudflared](https://github.com/cloudflare/cloudflared/releases)

> このリポジトリは **名前付き Tunnel（Cloudflare アカウント必須・固定ドメイン）** は使いません。  
> 起動のたびにランダムな `https://xxxx.trycloudflare.com` が発行される **Quick Tunnel** のみです。

---

## 1. cloudflared のインストール

リポジトリは cloudflared 本体を同梱・インストールしません。以下を手元で実行してください。

### 1.1 ダウンロード（Windows amd64）

1. [Downloads · Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/#windows) を開く
2.  **`cloudflared-windows-amd64.exe`**（**Executable** / **64-bit**）をダウンロードする 
3. ファイル名は **`cloudflared-windows-amd64.exe` のまま** にする

### 1.2 配置場所（優先順）

`scripts/server-start.ps1` は次の順で cloudflared を探します。

| 優先度 | 場所 | 例 |
|--------|------|----|
| 1 | 環境変数 `CLOUDFLARED_EXE` | `C:\Tools\cloudflared\cloudflared.exe` |
| 2 | リポジトリの `tools\` | `...\lab-management\tools\cloudflared-windows-amd64.exe` |
| 3 | ユーザーの Downloads | `%USERPROFILE%\Downloads\cloudflared-windows-amd64.exe` |

#### おすすめ: `tools\` に置く

```powershell
# リポジトリルートで実行する想定
# ダウンロードした exe を tools\ へコピー（パスは Downloads の実ファイル名に合わせる）
Copy-Item "$env:USERPROFILE\Downloads\cloudflared-windows-amd64.exe" `
  -Destination ".\tools\cloudflared-windows-amd64.exe"
```

`tools/.gitkeep` にも同趣旨の案内があります。  
**exe 自体は Git にコミットしない**運用を想定しています（バイナリは各自のマシンに置く）。

#### 代替: 環境変数でパスを指定

任意の場所に置いた場合:

```powershell
# 現在の PowerShell セッションだけ
$env:CLOUDFLARED_EXE = "C:\path\to\cloudflared-windows-amd64.exe"

# 永続化する場合は「システムの環境変数」または「ユーザー環境変数」に
# 名前: CLOUDFLARED_EXE
# 値:   C:\path\to\cloudflared-windows-amd64.exe
# を追加する（新しいターミナル / タスクから有効）
```

### 1.3 動作確認（任意）

```powershell
& ".\tools\cloudflared-windows-amd64.exe" --version
```

バージョン文字列が表示されれば OK です。

---

## 2. スクリプトでの起動・停止

### 2.1 前提

- Python 仮想環境と依存関係（`requirements.txt`）が整っている
- PostgreSQL などアプリ側のセットアップが済んでいる（[postgresql-setup.md](./postgresql-setup.md)）
- 上記のとおり cloudflared が配置済み

### 2.2 起動

リポジトリルートで:

```powershell
.\scripts\server-start.ps1
```

スクリプトが行うこと:

1. 前回の app / cloudflared の PID 残骸を掃除
2. Python で `main.py` を起動（ポート `5000` が既に開いていれば既存プロセスを利用）
3. `cloudflared tunnel --url http://127.0.0.1:5000` を起動
4. ログから `https://....trycloudflare.com` を抽出
5. **`data/tunnel_url.txt`** に公開 URL を書き込む（BOM なし UTF-8）
6. コンソールに `公開 URL: https://...` を表示

成功時の例:

```text
[start] 公開 URL: https://random-words-xxxx.trycloudflare.com
[start] 完了（プロセスは常駐します）
```

> PID や一時ログは `%TEMP%\lab-management\` に置きます。  
> リポジトリの `data/` に残るのは **`tunnel_url.txt` のみ** です。

### 2.3 停止

```powershell
.\scripts\server-stop.ps1
```

cloudflared とアプリを停止し、`data/tunnel_url.txt` を削除します。

---

## 3. 公開 URL の使われ方

| 場所 | 役割 |
|------|------|
| `data/tunnel_url.txt` | Quick Tunnel の現在の公開 URL（1 行） |
| API 応答の `public_url` | 疎通確認・クライアント向けに返す |
| VS Code 拡張の設定（Public URL） | プレースホルダ例: `https://xxxx.trycloudflare.com` |