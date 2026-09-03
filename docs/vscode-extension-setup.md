# VS Code 拡張（lab-tools）導入手順

lab-management のクライアントとして、VS Code / Cursor 向け拡張 **lab-tools**（`vscode-extension/lab-tools`）を使います。  
在室状況の表示・入退室・作業記録を、エディタのサイドバー／ステータスバーから操作できます。

このドキュメントでは **拡張の導入方法** をまとめます。

> Marketplace への公開は想定していません。現状は **リポジトリから開発ホストで起動** するか、**VSIX を手元で作ってインストール** します。

---

## 1. 前提（サーバー側）

拡張は lab-management の HTTP API に接続します。先にサーバーが動いている必要があります。


| 項目     | 内容                                                                                 |
| ------ | ---------------------------------------------------------------------------------- |
| アプリ起動  | `.\scripts\server-start.ps1`（既定ポート `5000`）                                         |
| メンバー   | Web 等で登録済みの `username` / パスワード                                                     |
| API キー | `.env` の `API_KEY`（在室・作業の POST で必須。メンバー共通の共有キー）                                    |
| LAN 接続 | 例: `192.168.x.x:5000`（設定の「サーバーIP:ポート」）                                             |
| 学外など   | cloudflared の公開 URL（設定の「公開URL」）。詳細は [cloudflared-setup.md](./cloudflared-setup.md) |


`.env.example` の該当箇所:

```text
# VS Code 拡張などからの在室・作業 API 用の共有キー（長いランダム文字列）
API_KEY=change-me-to-a-long-random-secret
```

---

## 2. 開発環境の準備

### 2.1 必要ツール

- **VS Code** または **Cursor**（VS Code 互換）
- **Node.js**（LTS 推奨）と npm

バージョン確認:

```powershell
node -v
npm -v
```

### 2.2 依存関係のインストールとビルド

```powershell
cd vscode-extension\lab-tools
npm install
npm run compile
```

`out/` にコンパイル結果が出ます。開発中は `npm run watch` で TypeScript を監視ビルドできます（F5 起動時の既定タスクも watch です）。

---

## 3. 拡張の導入方法

### 3.1 開発ホストで起動する（おすすめ・開発用）

1. VS Code / Cursor で `vscode-extension/lab-tools` **フォルダをワークスペースとして開く**
  （リポジトリルートではなく、拡張のフォルダを開く）
2. `Ctrl+Shift+B` などでビルド（watch）が動いていることを確認する（初回は `npm install` 済みであること）
3. **Run and Debug** から **「Run Extension」** を実行する（または `F5`）
4. 「Extension Development Host」ウィンドウが開く → ここに lab-tools が読み込まれる

`launch.json` は `preLaunchTask` で watch ビルドをかけてから Extension Host を起動します。

### 3.2 VSIX でインストールする（配布・常用向け）

Marketplace 未公開のため、パッケージを作って手動インストールします。

```powershell
cd vscode-extension\lab-tools
npm install
npm install -g @vscode/vsce   # 未導入の場合
npx vsce package
```

#### `vsce package` の確認プロンプト

社内配布のみのため、`package.json` に **`repository`** と **LICENSE ファイル** は置かない運用です。  
そのため次の WARNING が出ます。いずれも **`y` を入力して Enter** し、そのまま続行してください。

```text
WARNING  A 'repository' field is missing from the 'package.json' manifest file.
Use --allow-missing-repository to bypass.
Do you want to continue? [y/N] y

WARNING  LICENSE, LICENSE.md, or LICENSE.txt not found
Do you want to continue? [y/N] y
```

> 対話を避けたい場合は  
> `npx vsce package --allow-missing-repository`  
> でも `repository` 側はスキップできます。LICENSE の確認は別途出ることがあります。

生成された `lab-tools-*.vsix` は以下の手順でインストールできます。

- コマンドパレット → 「**vsix**」で検索
- **「Extensions: Install from VSIX...」** を選択し、ファイルを選ぶ  
または
- Cursor / VS Code の CLI:

```powershell
code --install-extension .\lab-tools-1.0.0.vsix
# Cursor の場合は cursor コマンドでも可
# ファイル名のバージョンは package.json の version に合わせる
```

インストール後はウィンドウの再読み込み（Reload Window）が必要なことがあります。
