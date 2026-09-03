# Slack アプリ セットアップ手順

lab-management は **1 つの Slack アプリ** で次を行います。

| 機能 | 用途 |
|------|------|
| **Sign in with Slack**（OpenID Connect） | Web ログイン。Slack ユーザー ID（`sub`）でメンバーを特定 |
| **Bot（DM）** | 役職の一般↔管理者変更時、変更者へ Collaborator 手動追加／削除の案内を送る |

公式:

- [Using Sign in with Slack](https://api.slack.com/authentication/sign-in-with-slack)
- [chat.postMessage](https://docs.slack.dev/reference/methods/chat.postmessage)
- [conversations.open](https://docs.slack.dev/reference/methods/conversations.open)

---

## 全体の流れ（チェックリスト）

1. Slack アプリを新規作成する
2. Sign in with Slack（Redirect URL）を設定する
3. Bot Token Scopes を追加し、ワークスペースへインストールする
4. `.env` に Client ID / Secret / Bot Token などを書く
5. DB を init / reset し、管理者でログインできることを確認する
6. 役職変更で DM が届くことを確認する

---

## 1. Slack アプリを作る

1. [Slack API: Create an app](https://api.slack.com/apps?new_app=1) を開く
2. **Create New App** で **From scratch**（Blank app）を選ぶ
3. **App Name**（例: `Lab Tools`）を入力し、導入するワークスペースを選んで作成する
4. 左メニュー **Basic Information** で次を控える
   - **Client ID**
   - **Client Secret**（Show してコピー）
   - **App ID**

---

## 2. Sign in with Slack（ログイン用）

1. 左メニュー **OAuth & Permissions** を開く
2. **Redirect URLs** にコールバック URL を追加して保存する  
   例: `http://サーバーIP:ポート/auth/slack/callback`
   > 必ず **Save URLs** を押す  
   > 編集時は **Done → Save URLs**（忘れがち）
3. Sign in with Slack は OpenID Connect を使います（このリポジトリでは scope `openid profile`）

この時点ではまだ Bot は不要ですが、同じアプリに後で Bot を足します。

---

## 3. Bot を有効にし、DM 用スコープを追加する

役職変更時の案内 DM に必要です。

1. 左メニュー **OAuth & Permissions** を開く
2. **ボットトークンのスコープ** を探し、**OAuth スコープを追加する** から次を追加する

| Scope | 用途 |
|-------|------|
| `chat:write` | DM にメッセージを送る（`chat.postMessage`） |
| `im:write` | 変更者との DM を開く（`conversations.open`） |

3. ページ上部の **Install to Workspace**（または **Reinstall to Workspace**）を実行し、許可する
4. 表示された **OAuth Tokens** 内の **Bot User OAuth Token**（`xoxb-…` で始まる）を控える  
   > 今後もスコープを変えたあとは必ず再インストールが必要です

---

## 4. 環境変数（`.env`）を設定する

```powershell
Copy-Item .env.example .env
# .env を編集
```

Slack 関連の例:

```env
# Sign in with Slack
SLACK_CLIENT_ID=1234567890.1234567890123
SLACK_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SLACK_APP_ID=A012ABCDEF

SLACK_REDIRECT_URI=http://サーバーIP:ポート/auth/slack/callback

# Bot（役職変更時の Collaborator 案内 DM）
SLACK_BOT_TOKEN=xoxb-...

# DB seed 用の初期管理者（Slack メンバー ID）
ADMIN_SLACK_USER_ID=U012ABCDEF

# セッション Cookie 署名
SESSION_SECRET=ランダムな長い文字列を自由に設定
```

| 変数 | 説明 |
|------|------|
| `SLACK_CLIENT_ID` | Basic Information の Client ID |
| `SLACK_CLIENT_SECRET` | Basic Information の Client Secret |
| `SLACK_APP_ID` | DM 内の Collaborators 画面リンク用（`https://api.slack.com/apps/<APP_ID>/collaborators`） |
| `SLACK_REDIRECT_URI` | Redirect URLs と **完全一致**。未設定時は `http://localhost:5000/auth/slack/callback` |
| `SLACK_BOT_TOKEN` | Bot User OAuth Token（`xoxb-…`）。 |
| `ADMIN_SLACK_USER_ID` | 初期管理者の Slack メンバー ID（`U…`） |
| `SESSION_SECRET` | セッション Cookie 署名。本番では推測困難な値にする |

`ADMIN_SLACK_USER_ID` は Slack プロフィールのメンバー ID です。 `.\scripts\db-init.ps1` または `.\scripts\db-reset.ps1` を実行時、その ID 付きの管理者（`username=admin`）が投入されます。

---

## 5. 動作確認

### 5.1 ログイン

1. サーバーを起動する
2. ブラウザでサイトを開き **Slack でログイン** する
3. 未登録なら自己登録、登録済み（seed 管理者含む）ならそのままログインできる

### 5.2 役職変更時の DM

1. 管理者 A でログインし、メンバー B の役職を **一般 → 管理者**（またはその逆）に変更する
2. 管理者 A の Slack DM（アプリからのメッセージ）に案内が届く

| 変更 | DM の内容（概要） |
|------|-------------------|
| 一般 → 管理者 | 被変更者を App Collaborators に **追加** するよう案内 |
| 管理者 → 一般 | 被変更者を App Collaborators から **削除** するよう案内 |

- 宛先は常に **変更を行った人**（変更者）です。Web 画面上のトースト等は出しません
- Collaborator の追加／削除自体は Slack 管理画面での手動操作です（公式の公開 Bot API では書き換えません）
- `SLACK_BOT_TOKEN` 未設定・送信失敗時はログに残し、役職の DB 更新は成功のままにします

Collaborators 画面: アプリ → 左メニュー **Collaborators**、または  
`https://api.slack.com/apps/<APP_ID>/collaborators`

---

## 6. Sign in with Slack の技術要約（参考）

### 6.1 概要

- OpenID Connect（OAuth 2.0 上の認証）
- 許可後に一時コード `code` が返り、サーバーがトークンと交換する
- `sub`（Slack ユーザー ID）を `members.slack_user_id` と照合する

### 6.2 流れ

#### 認可リクエスト（ブラウザ ➝ Slack）

ユーザーを次の URL にリダイレクトします。

```text
https://slack.com/openid/connect/authorize
```

| パラメータ | 例 | 説明 |
|------------|-----|------|
| `response_type` | `code` | 認可コード方式 |
| `scope` | `openid profile` | 最低 `openid` |
| `client_id` | アプリの Client ID | |
| `redirect_uri` | コールバック URL | アプリ設定と一致 |
| `state` | ランダム | CSRF 対策 |
| `nonce` | ランダム | 改ざん検知 |

このリポジトリでは `/auth/slack` が組み立ててリダイレクトします。

#### コールバック（Slack ➝ あなたのサーバー）

ユーザーが許可すると、`redirect_uri` に `code` と `state` が付いて戻ります。
`state` が開始時と一致しない場合は拒否します。

#### トークン交換（サーバー ➝ Slack API）

```text
POST https://slack.com/api/openid.connect.token
```

`grant_type=authorization_code` と `code` / `client_id` / `client_secret` / `redirect_uri` を送ります。

#### ユーザー情報

`openid.connect.userInfo` に Bearer トークン付きでアクセスし、最新のプロフィールを取得できます。
```text
GET https://slack.com/api/openid.connect.userInfo
Authorization: Bearer {access_token}
```

このリポジトリでは `sub` をメンバー特定に使います。未登録なら自己登録フローへ進みます。

---
