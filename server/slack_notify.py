"""
Slack Bot による DM 通知。

- 役職の一般↔管理者変更時、変更者へ App Collaborator の手動追加／削除案内を送る
- Lab Tools 拡張の配布時、全メンバーへ VSIX 付き DM を送る
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from server.config import load_slack_app_id, load_slack_bot_token

logger = logging.getLogger(__name__)

_SLACK_API = "https://slack.com/api"
_ROLE_MEMBER = "member"
_ROLE_ADMIN = "admin"
# files.completeUploadExternal の channels 上限
_MAX_SHARE_CHANNELS = 100


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
    return _read_slack_response(request, method)


def _post_slack_api_form(method: str, token: str, fields: dict[str, str]) -> dict:
    """Slack Web API に form-urlencoded POST し、応答 dict を返す。"""
    body = urllib.parse.urlencode(fields).encode("utf-8")
    request = urllib.request.Request(
        f"{_SLACK_API}/{method}",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        method="POST",
    )
    return _read_slack_response(request, method)


def _read_slack_response(request: urllib.request.Request, method: str) -> dict:
    """HTTP 応答を JSON dict として読む。"""
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Slack API HTTP {exc.code} ({method}): {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Slack API 接続に失敗しました ({method}): {exc}") from exc

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Slack API 応答が JSON ではありません ({method})") from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"Slack API 応答の形式が不正です ({method})")
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


def _get_upload_url(token: str, *, filename: str, length: int) -> tuple[str, str]:
    """
    外部アップロード用 URL と file_id を取得する。
    @returns (upload_url, file_id)
    """
    data = _post_slack_api_form(
        "files.getUploadURLExternal",
        token,
        {
            "filename": filename,
            "length": str(length),
        },
    )
    if not data.get("ok"):
        raise RuntimeError(f"files.getUploadURLExternal 失敗: {data.get('error')}")
    upload_url = str(data.get("upload_url") or "").strip()
    file_id = str(data.get("file_id") or "").strip()
    if not upload_url or not file_id:
        raise RuntimeError("files.getUploadURLExternal が upload_url / file_id を返しませんでした")
    return upload_url, file_id


def _put_file_bytes(upload_url: str, content: bytes, filename: str) -> None:
    """取得した upload_url へファイル本体を POST する。"""
    boundary = "----labtoolsBoundary7MA4YWxkTrZu0gW"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode("utf-8") + content + f"\r\n--{boundary}--\r\n".encode("utf-8")
    request = urllib.request.Request(
        upload_url,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            if response.status != 200:
                detail = response.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"ファイルアップロード失敗 HTTP {response.status}: {detail}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ファイルアップロード HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"ファイルアップロード接続に失敗しました: {exc}") from exc


def _complete_upload(
    token: str,
    *,
    file_id: str,
    title: str,
    channel_ids: list[str],
    initial_comment: str,
) -> None:
    """アップロードを確定し、指定チャンネルへ共有する。"""
    if not channel_ids:
        raise RuntimeError("共有先チャンネルが空です")
    if len(channel_ids) > _MAX_SHARE_CHANNELS:
        raise RuntimeError(
            f"共有先が {_MAX_SHARE_CHANNELS} 件を超えています（{len(channel_ids)}）"
        )
    payload: dict = {
        "files": [{"id": file_id, "title": title}],
        "channels": ",".join(channel_ids),
        "initial_comment": initial_comment,
    }
    data = _post_slack_api("files.completeUploadExternal", token, payload)
    if not data.get("ok"):
        raise RuntimeError(f"files.completeUploadExternal 失敗: {data.get('error')}")


def _upload_and_share_file(
    token: str,
    *,
    file_path: Path,
    channel_ids: list[str],
    initial_comment: str,
) -> None:
    """
    ファイルをアップロードし、チャンネル群へ共有する。
    complete は file ごとに1回のため、100件超はバッチごとに再アップロードする。
    """
    content = file_path.read_bytes()
    filename = file_path.name
    title = filename

    for offset in range(0, len(channel_ids), _MAX_SHARE_CHANNELS):
        batch = channel_ids[offset : offset + _MAX_SHARE_CHANNELS]
        upload_url, file_id = _get_upload_url(
            token,
            filename=filename,
            length=len(content),
        )
        _put_file_bytes(upload_url, content, filename)
        _complete_upload(
            token,
            file_id=file_id,
            title=title,
            channel_ids=batch,
            initial_comment=initial_comment,
        )
        if offset + _MAX_SHARE_CHANNELS < len(channel_ids):
            time.sleep(1.0)


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
            f"Slack App の Collaborators に {mention}（ `{target_slack_user_id}` ）を"
            " *追加* してください。\n"
            f"<{url}|Collaborators を開く>"
        )
    return (
        f"lab-management で {target_name} の役職を *一般* に変更しました。\n"
        f"Slack App の Collaborators から {mention}（ `{target_slack_user_id}` ）を"
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


def build_lab_tools_release_comment(*, version: str, changelog_text: str) -> str:
    """Lab Tools 配布 DM の本文を組み立てる。"""
    version = (version or "").strip()
    changelog = (changelog_text or "").strip()
    lines = [
        f"Lab Tools 拡張の *バージョン {version}* がリリースされました。",
        "添付の `.vsix` を VS Code / Cursor で再インストールしてください。",
        "（ Ctrl+Shift+P → *Extensions: Install from VSIX...* ）",
    ]
    if changelog:
        lines.extend(["", changelog])
    return "\n".join(lines)


def notify_lab_tools_release(
    *,
    vsix_path: Path | str,
    version: str,
    changelog_text: str,
    slack_user_ids: list[str],
    dry_run: bool = False,
) -> dict[str, int]:
    """
    Lab Tools の VSIX を全メンバー DM に送る。
    @returns {"ok": 成功数, "failed": 失敗数, "skipped": スキップ数}
    """
    path = Path(vsix_path)
    if not path.is_file():
        raise FileNotFoundError(f"VSIX が見つかりません: {path}")

    recipients = sorted({(uid or "").strip() for uid in slack_user_ids if (uid or "").strip()})
    if not recipients:
        raise RuntimeError("送信先の slack_user_id がありません")

    comment = build_lab_tools_release_comment(
        version=version,
        changelog_text=changelog_text,
    )

    if dry_run:
        logger.info(
            "dry-run: Lab Tools %s を %d 名へ送る想定（ファイル=%s）",
            version,
            len(recipients),
            path.name,
        )
        for uid in recipients:
            logger.info("dry-run recipient: %s", uid)
        return {"ok": 0, "failed": 0, "skipped": len(recipients)}

    token = load_slack_bot_token()
    if not token:
        raise RuntimeError("SLACK_BOT_TOKEN が未設定です")

    channel_ids: list[str] = []
    failed_open = 0
    for uid in recipients:
        try:
            channel_ids.append(_open_dm_channel(token, uid))
        except Exception:
            failed_open += 1
            logger.exception("DM オープンに失敗しました（user=%s）", uid)

    if not channel_ids:
        raise RuntimeError("いずれのメンバーとも DM を開けませんでした")

    _upload_and_share_file(
        token,
        file_path=path,
        channel_ids=channel_ids,
        initial_comment=comment,
    )
    logger.info(
        "Lab Tools 配布 DM を送信しました（version=%s, ok=%d, open_failed=%d）",
        version,
        len(channel_ids),
        failed_open,
    )
    return {"ok": len(channel_ids), "failed": failed_open, "skipped": 0}
