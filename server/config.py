import logging
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"
# cloudflared Quick Tunnel の公開 URL（起動スクリプトが書き込む）
TUNNEL_URL_FILE = ROOT / "data" / "tunnel_url.txt"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)


def _load_dotenv_file() -> None:
    """リポジトリ直下の .env を読み込む。既存の環境変数は上書きしない。"""
    if not ENV_FILE.exists():
        return
    try:
        from dotenv import load_dotenv
    except ImportError:
        logging.getLogger(__name__).warning(
            "python-dotenv が未インストールのため .env を読み込めません"
        )
        return
    load_dotenv(ENV_FILE, override=False)


_load_dotenv_file()


def load_public_tunnel_url() -> str | None:
    """
    Quick Tunnel の公開 URL を data/tunnel_url.txt から読む。
    未作成・空・不正なら None。
    """
    if not TUNNEL_URL_FILE.exists():
        return None
    try:
        # PowerShell Set-Content -Encoding utf8 は BOM 付きのため utf-8-sig で読む
        text = TUNNEL_URL_FILE.read_text(encoding="utf-8-sig").strip()
    except OSError:
        return None
    if not text:
        return None
    url = text.split()[0].strip()
    if not url.startswith("https://"):
        return None
    return url


def load_database_url() -> str | None:
    """
    PostgreSQL 接続 URL を返す。
    優先順: プロセス環境変数 DATABASE_URL → .env の DATABASE_URL。
    """
    url = os.environ.get("DATABASE_URL", "").strip()
    return url or None


def load_api_key() -> str | None:
    """
    共有 API キーを返す。
    優先順: プロセス環境変数 API_KEY → .env の API_KEY。
    """
    key = os.environ.get("API_KEY", "").strip()
    return key or None


def load_session_secret() -> str:
    """セッション署名用シークレットを返す。"""
    secret = os.environ.get("SESSION_SECRET", "").strip()
    return secret or None


def load_slack_client_id() -> str | None:
    """Slack OAuth クライアント ID。"""
    value = os.environ.get("SLACK_CLIENT_ID", "").strip()
    return value or None


def load_slack_client_secret() -> str | None:
    """Slack OAuth クライアントシークレット。"""
    value = os.environ.get("SLACK_CLIENT_SECRET", "").strip()
    return value or None


def load_slack_redirect_uri() -> str:
    """Slack OAuth コールバック URL。"""
    value = os.environ.get("SLACK_REDIRECT_URI", "").strip()
    if value:
        return value
    return "http://localhost:5000/auth/slack/callback"


def load_admin_slack_user_id() -> str | None:
    """seed（db-init / db-reset）に必須の管理者 Slack ユーザー ID。"""
    value = os.environ.get("ADMIN_SLACK_USER_ID", "").strip()
    return value or None


def load_slack_bot_token() -> str | None:
    """Bot User OAuth Token（xoxb-…）。"""
    value = os.environ.get("SLACK_BOT_TOKEN", "").strip()
    return value or None


def load_slack_app_id() -> str | None:
    """Slack アプリ ID（Collaborators 画面リンク用）。"""
    value = os.environ.get("SLACK_APP_ID", "").strip()
    return value or None
