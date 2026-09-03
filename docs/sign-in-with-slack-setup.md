# Sign in with Slack セットアップ手順

lab-management の Web ログインは、Slack の **Sign in with Slack**（OpenID Connect）を使います。  
ユーザーは Slack アカウントで認証し、取得した **Slack ユーザー ID**（`sub`）をもとにメンバーを特定します。

公式ドキュメント: [Using Sign in with Slack](https://api.slack.com/authentication/sign-in-with-slack)

---

## 1. Slack アプリを作る

1. [Slack API: Create an app](https://api.slack.com/apps?new_app=1) を開く
2. **Crate New App** で **Blank app** を選択する
3. **App Name**`（例）Lab Tools` を入力し、導入したいコミュニティのワークスペースを選んで作成する
4. 左メニュー **OAuth & Permissions** を開く
5. **Redirect URLs** にコールバック URL `（例）http://サーバーIP:ポート/auth/slack/callback` を追加して保存する
  > 必ず **Save URLs** を押す
  > 編集時は **Done ➝ Save URLs** （忘れがち）
6. 左メニュー **Basic Information** で **Client ID** と **Client Secret** を控える

---

## 2. 環境変数を設定する

`.env` を編集し、次を設定する。

```env
SLACK_CLIENT_ID=1234567890.1234567890123
SLACK_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SLACK_REDIRECT_URI=http://サーバーIP:ポート/auth/slack/callback
SESSION_SECRET=ランダムな長い文字列を自由に設定
```

| 変数                    | 説明                             |
| --------------------- | ------------------------------ |
| `SLACK_CLIENT_ID`     | Slack アプリの Client ID           |
| `SLACK_CLIENT_SECRET` | Slack アプリの Client Secret       |
| `SLACK_REDIRECT_URI`  | 2. で登録した URL と **完全一致** させる    |
| `SESSION_SECRET`      | セッション Cookie 署名用。本番では推測困難な値にする |

これでセットアップ完了です。

---

## 3. 公式の要約
### 3.1 Sign in with Slack とは

Slack のプロフィールを使って、あなたのサービスにログインさせる仕組みです。

- 標準は **OpenID Connect**（OAuth 2.0 の上に載った認証方式）
- ユーザーが Slack で許可すると、あなたのサーバーに **一時コード（**`code`**）** が返る
- サーバーがそのコードを **アクセストークン** に交換し、ユーザー情報を取得する
- 取得した `sub`**（Slack ユーザー ID）** で、自前 DB のメンバーと紐付ける

---

### 3.2 技術的な流れ

Slack 公式が説明している手順は、次の 4 段階です。

#### 3.2.1 認可リクエスト（ブラウザ → Slack）

ユーザーを次の URL にリダイレクトします。

```text
https://slack.com/openid/connect/authorize
```

主なクエリパラメータ:


| パラメータ           | 値の例              | 説明                                    |
| --------------- | ---------------- | ------------------------------------- |
| `response_type` | `code`           | 認可コード方式                               |
| `scope`         | `openid profile` | 最低 `openid` が必要。メールも欲しければ `email` を追加 |
| `client_id`     | アプリの Client ID   |                                       |
| `redirect_uri`  | コールバック URL       | アプリ設定と一致させる                           |
| `state`         | ランダム文字列          | CSRF 対策。コールバックで照合する                   |
| `nonce`         | ランダム文字列          | 改ざん検知。トークン応答の JWT で照合する               |


このリポジトリでは `/auth/slack` が上記を組み立ててリダイレクトします。

#### 3.2.2 コールバック（Slack → あなたのサーバー）

ユーザーが許可すると、`redirect_uri` に `code` と `state` が付いて戻ります。  
`state` が開始時と一致しない場合は拒否します。

#### 3.2.3 トークン交換（サーバー → Slack API）

`code` を `openid.connect.token` に POST して、アクセストークンと `id_token`（JWT）を受け取ります。

```text
POST https://slack.com/api/openid.connect.token
```

送信する主な項目:

- `grant_type=authorization_code`
- `code`
- `client_id`
- `client_secret`
- `redirect_uri`

応答例:

```json
{
  "ok": true,
  "access_token": "xoxp-...",
  "token_type": "Bearer",
  "id_token": "eyJ..."
}
```

`id_token` をデコードすると `sub`（Slack ユーザー ID）、`email`、`name` などが含まれます。  
`nonce` がリクエスト時と一致するか確認することが推奨されています。

#### 3.2.4 ユーザー情報の取得（任意・推奨）

`openid.connect.userInfo` に Bearer トークン付きでアクセスし、最新のプロフィールを取得できます。

```text
GET https://slack.com/api/openid.connect.userInfo
Authorization: Bearer {access_token}
```

このリポジトリでは `sub` を `members.slack_user_id` と照合しています。