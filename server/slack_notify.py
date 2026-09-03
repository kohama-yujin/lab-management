"""
Slack Bot による DM 通知。

役職の一般↔管理者変更時、変更者へ App Collaborator の手動追加／削除案内を送る。
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request

from server.config import load_slack_app_id, load_slack_bot_token

logger = logging.getLogger(__name__)

_SLACK_API = "https://slack.com/api"
_ROLE_MEMBER = "member"
_ROLE_ADMIN = "admin"


def _post_slack_api(method: str, token: str, payload: dict) -> dict:
    """Slack Web API に JSON POST し、応答 dict を返す。"""
    request = urllib.request.Request(
        f"{_SLACK_API}/{method}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Slack API HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Slack API 接続に失敗しました: {exc}") from exc

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Slack API 応答が JSON ではありません") from exc
    if not isinstance(data, dict):
        raise RuntimeError("Slack API 応答の形式が不正です")
    return data


def _open_dm_channel(token: str, slack_user_id: str) -> str:
    """指定ユーザーとの DM チャンネル ID を返す。"""
    data = _post_slack_api(
        "conversations.open",
        token,
        {"users": slack_user_id},
    )
    if not data.get("ok"):
        raise RuntimeError(f"conversations.open 失敗: {data.get('error')}")
    channel = data.get("channel") or {}
    channel_id = str(channel.get("id") or "").strip()
    if not channel_id:
        raise RuntimeError("conversations.open が channel.id を返しませんでした")
    return channel_id


def _post_dm(token: str, channel_id: str, text: str) -> None:
    """DM チャンネルにテキストを送る。"""
    data = _post_slack_api(
        "chat.postMessage",
        token,
        {"channel": channel_id, "text": text},
    )
    if not data.get("ok"):
        raise RuntimeError(f"chat.postMessage 失敗: {data.get('error')}")


def _collaborators_url() -> str:
    """Collaborators 管理画面の URL。"""
    app_id = load_slack_app_id()
    if app_id:
        return f"https://api.slack.com/apps/{app_id}/collaborators"
    return "https://api.slack.com/apps"


def _build_guidance_text(
    *,
    action: str,
    target_name: str,
    target_slack_user_id: str,
) -> str:
    """
    Collaborator 案内文を組み立てる。
    action は add または remove。
    """
    mention = f"<@{target_slack_user_id}>"
    url = _collaborators_url()
    if action == "add":
        return (
            f"lab-management で {target_name} の役職を *管理者* に変更しました。\n"
            f"Slack App の Collaborators に {mention}（`{target_slack_user_id}` / {target_name}）を"
            " *追加* してください。\n"
            f"<{url}|Collaborators を開く>"
        )
    return (
        f"lab-management で {target_name} の役職を *一般* に変更しました。\n"
        f"Slack App の Collaborators から {mention}（`{target_slack_user_id}` / {target_name}）を"
        " *削除* してください。\n"
        f"<{url}|Collaborators を開く>"
    )


def notify_collaborator_guidance(
    *,
    actor_slack_user_id: str | None,
    target_slack_user_id: str | None,
    target_name: str,
    old_role: str,
    new_role: str,
) -> None:
    """
    一般↔管理者の役職変更時、変更者へ Collaborator 案内 DM を送る。
    対象外の役職変化・トークン未設定は何もしない。失敗はログのみ（呼び出し側の処理は継続）。
    """
    old = (old_role or "").strip()
    new = (new_role or "").strip()
    if old == new:
        return

    if old == _ROLE_MEMBER and new == _ROLE_ADMIN:
        action = "add"
    elif old == _ROLE_ADMIN and new == _ROLE_MEMBER:
        action = "remove"
    else:
        return

    token = load_slack_bot_token()
    if not token:
        logger.warning(
            "SLACK_BOT_TOKEN 未設定のため Collaborator 案内 DM をスキップします"
        )
        return

    actor_id = (actor_slack_user_id or "").strip()
    target_id = (target_slack_user_id or "").strip()
    if not actor_id:
        logger.warning("変更者の slack_user_id が無いため案内 DM をスキップします")
        return
    if not target_id:
        logger.warning("被変更者の slack_user_id が無いため案内 DM をスキップします")
        return

    text = _build_guidance_text(
        action=action,
        target_name=target_name or target_id,
        target_slack_user_id=target_id,
    )
    try:
        channel_id = _open_dm_channel(token, actor_id)
        _post_dm(token, channel_id, text)
        logger.info(
            "Collaborator 案内 DM を送信しました（action=%s, actor=%s, target=%s）",
            action,
            actor_id,
            target_id,
        )
    except Exception:
        logger.exception(
            "Collaborator 案内 DM の送信に失敗しました（action=%s, actor=%s, target=%s）",
            action,
            actor_id,
            target_id,
        )
