# PostgreSQL セットアップ手順

lab-management は **PostgreSQL** にメンバー・在室履歴などを保存します。  
このドキュメントでは **インストール（手作業）** と **リポジトリ付属スクリプト（自動）** の役割分担を説明します。

---

## 1. 全体の流れ

| 段階 | 誰がやる | 内容 |
|------|----------|------|
| ① PostgreSQL インストール | **手作業** | Windows に PostgreSQL を入れる |
| ② 接続設定 | **手作業** | `.env` または環境変数で `DATABASE_URL` を設定 |
| ③ DB 初期化 | **スクリプト** | `scripts/db-init.ps1` で DB 作成・テーブル・初期データ |
| ④ アプリ起動 | **スクリプト** | `scripts/server-start.ps1`（Python が `.env` を自動読込） |

---

## 2. PostgreSQL のインストール（手順書のみ）

リポジトリは PostgreSQL 本体をインストールしません。以下を手元で実行してください。

### 2.1 ダウンロードとインストール（Windows）

1. [PostgreSQL 公式](https://www.postgresql.org/download/windows/) からインストーラを取得
2. インストールウィザードで以下をメモする
   - **Password（パスワード）** … ウィザードで入力するのはこれだけ。ユーザー名を聞かれる画面は **ない**
   - **ポート**（既定: `5432`）
> パスワードに `@` `#` `%` などが含まれる場合、URL 内では **URL エンコード** が必要です（例: `@` → `%40`）。  
> 最初は英数字だけのパスワードにしておくと設定が簡単です。

3. オプションで **pgAdmin 4** も入れておくと GUI で確認しやすい

### 2.2 サービス確認

- PowerShell:

```powershell
Get-Service -Name "postgresql*"
```
`postgresql-x64-*` が **実行中** であることを確認

---

## 3. DATABASE_URL の設定

### 3.1 形式

```
postgresql://ユーザー:パスワード@ホスト:ポート/データベース名
         ^^^^^^^^  ^^^^^^^^^
         固定      インストール時に
         postgres  自分で決めたパスワード
```

> **ユーザー名はどこで決まる？**  
> Windows 版インストーラは最初から **スーパーユーザー名 `postgres`** でサーバーを作ります。  
> 入力するのは **パスワードのみ** です。`DATABASE_URL` の `postgres:` の部分は、この固定ユーザー名を指します。

例（ローカル開発）:

```
postgresql://postgres:mysecret@localhost:5432/lab_management_dev
```

| 部分 | 意味 | どこで決めるか |
|------|------|----------------|
| `postgres` | DB ユーザー名 | **インストーラが自動設定**（入力欄なし）。追加ユーザーを作らない限りこれを使う |
| `mysecret` | パスワード | インストールウィザードの **Password** 画面 |
| `localhost` | 接続先 | 同じ PC なら `localhost` |
| `5432` | ポート | インストール時（通常は 5432 のまま） |
| `lab_management_dev` | データベース名 | **自分で `.env` に書く**。`db-init` が無ければ自動作成 |

### 3.2 `.env` ファイル（ローカル開発向け）

1. テンプレートをコピー:

```powershell
Copy-Item .env.example .env
```

2. `.env` を編集し `DATABASE_URL` を自分の環境に合わせる

3. **`.env` は Git にコミットしない**（`.gitignore` 済み）

アプリ起動時、`server/config.py` がリポジトリ直下の `.env` を読み込みます。

### 3.3 環境変数（本番・タスクスケジューラ向け）

PowerShell で **そのセッションだけ** 設定:

```powershell
$env:DATABASE_URL = "postgresql://postgres:mysecret@localhost:5432/lab_management_dev"
```

Windows の「環境変数」設定で **ユーザー/システム** に追加すると永続化されます。  
`scripts/register-task.ps1` で登録したタスクから DB を使う場合は、こちら（またはタスク専用の環境変数）が確実です。

**永続化した環境変数は 1 値のみ** です。OS に `DATABASE_URL=...lab_management_dev` を登録すると、`.env` より優先され、**dev / test の切り替えには向きません**（切り替えるたびに OS 設定を書き換える必要がある）。そのため、永続化させる場合は本番環境を推奨します。

---

## 4. データベース操作（スクリプト）

### 4.1 前提

```powershell
python -m venv venv
.\venv\Scripts\pip install -r requirements.txt
Copy-Item .env.example .env
# .env を編集
```

### 4.2 初期化

```powershell
.\scripts\db-init.ps1
```

内部で `tools/db_setup.py init` を実行します。

- `DATABASE_URL` の **データベースが無ければ CREATE DATABASE**
- `db/schema.sql` でテーブル作成（既にあればスキップ）
- `db/seed.sql` で学年・役職マスタ投入（再実行可）

### 4.3 状態確認

```powershell
.\scripts\db-status.ps1
```

出力例:

```
database: lab_management_dev
  roles: 2
  grades: 5
  members: 0
  attendance_sessions: 0
```

### 4.4 リセット（開発・テスト用・全データ消去）

```powershell
.\scripts\db-reset.ps1
# 確認プロンプト省略:
.\scripts\db-reset.ps1 -Yes
```

`public` スキーマを DROP して作り直し、`schema.sql` / `seed.sql` を再適用します。

---

## 5. pgAdmin 4 の使い方

pgAdmin 4 は PostgreSQL 付属の **GUI 管理ツール** です。テーブルの中身を見たり、SQL を試したりできます。

### 初回起動

1. スタートメニューから **pgAdmin 4** を起動（初回は少し時間がかかる）
2. **Master Password** を聞かれたら、pgAdmin 自体のロック用パスワードを設定（PostgreSQL のパスワードとは別。忘れたら pgAdmin 設定のリセットが必要）
3. 左ペイン **Servers** を展開 → **PostgreSQL 16**（バージョンは環境による）をクリック
4. 接続パスワードを入力 … **インストール時に設定した postgres のパスワード**（`DATABASE_URL` に書くものと同じ）

### データベースとテーブルを確認する

1. 左ペイン: **Servers → PostgreSQL → Databases**
2. `db-init.ps1` 実行後、`lab_management_dev`（`.env` で指定した DB 名）が表示される
3. **Schemas → public → Tables** に `members`, `grades` などが並ぶ
4. テーブルを右クリック → **View/Edit Data → All Rows** で中身を表示

### SQL を直接実行する

1. 対象 DB（例: `lab_management_dev`）を右クリック → **Query Tool**
2. SQL を入力して **▶ Execute**（F5）
3. 例: `SELECT * FROM grades;`

### よく使う場面

| やりたいこと | 操作 |
|--------------|------|
| db-init が成功したか | Databases に DB 名があるか、Tables に 4 テーブルがあるか |
| seed データの確認 | `grades` / `roles` テーブルの行数 |
| 接続テスト | サーバー接続時に postgres パスワードが通るか |

> pgAdmin は **必須ではありません**。`scripts/db-status.ps1` でも接続・件数確認ができます。

---

## 6. dev / test で DB を切り替える

本番・開発・テストは **PostgreSQL 上の別データベース**（別名）に分けるのが一般的です。  
切り替えるのは URL の **末尾の DB 名** だけです（ユーザー `postgres` やパスワードは同じでよい）。

| 用途 | DB 名の例 |
|------|-----------|
| 開発 | `lab_management_dev` |
| テスト | `lab_management_test` |

### 6.1 毎回 DB 名を設定する必要がある？

**常に設定し直す必要はありません。**

`.env` に dev 用 URL を書いたまま普段使う。テスト DB が要るときだけ一時的に上書きする。

```powershell
# 普段: .env の lab_management_dev をそのまま使う
.\scripts\server-start.ps1

# テスト DB 向けに一時切替（この PowerShell ウィンドウだけ）
$env:DATABASE_URL = "postgresql://postgres:パスワード@localhost:5432/lab_management_test"
.\scripts\db-reset.ps1 -Yes   # 例: テスト前リセット
# テスト実行 ...
```

ウィンドウを閉じれば `$env:DATABASE_URL` は消え、次回は再び `.env` の dev が使われます。


### 6.2 初回セットアップ

dev / test それぞれで **1 回ずつ** `db-init` します。

```powershell
# dev（.env が dev を指している状態）
.\scripts\db-init.ps1

# test（DATABASE_URL を test に切り替えた状態）
$env:DATABASE_URL = "postgresql://postgres:パスワード@localhost:5432/lab_management_test"
.\scripts\db-init.ps1
```

**同じ DB で開発と破壊的テスト（db-reset 等）を兼ねない** ようにしてください。