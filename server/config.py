import json
import logging
import os
from pathlib import Path

CHECK_INTERVAL_SECONDS = 60
MAX_TARGETS = 20

ROOT = Path(__file__).resolve().parents[1]
API_KEY_FILE = ROOT / "api_key.json"
# cloudflared Quick Tunnel の公開 URL（起動スクリプトが書き込む）
TUNNEL_URL_FILE = ROOT / "data" / "tunnel_url.txt"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)


def load_database_url() -> str | None:
    """環境変数 DATABASE_URL を返す。未設定なら None。"""
    url = os.environ.get("DATABASE_URL", "").strip()
    return url or None


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


def load_api_key() -> str | None:
    """
    共有 API キーを api_key.json から読み込む。
    未設定・空なら None。
    """
    if not API_KEY_FILE.exists():
        return None
    try:
        with API_KEY_FILE.open(encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict):
        return None
    key = raw.get("api_key")
    if not isinstance(key, str):
        return None
    key = key.strip()
    return key or None
