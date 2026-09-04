"""work_sessions テーブルの作業開始・終了登録。"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, TypedDict
from zoneinfo import ZoneInfo

from server.db import StoreError, connect, is_unique_violation
from server.stores.attendance import _authenticate
from server.stores.member import _fetch_member
from server.stores.status import (
    JST,
    _ensure_jst,
)

logger = logging.getLogger(__name__)

class WorkResult(TypedDict):
    ok: bool
    message: str
    ignored: bool


def _parse_end_at(value: Any) -> datetime | None:
    """リクエストの end_at（ISO 8601）を JST に変換する。省略時は None。"""
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise StoreError("end_at が不正です", 400)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise StoreError("end_at が不正です", 400) from exc
    return _ensure_jst(parsed)


def _is_present(cur, member_id: int) -> bool:
    cur.execute(
        """
        SELECT id
        FROM attendance_sessions
        WHERE member_id = %s AND end_at IS NULL
        LIMIT 1
        """,
        (member_id,),
    )
    return cur.fetchone() is not None


def start_work(username: str, password: str, *, location: str | None = None) -> WorkResult:
    """作業セッションを開始する。在室中のみ。既に作業中なら ignored。"""
    work_location = (location or "lab").strip() or "lab"
    if work_location not in ("lab", "outside_lab"):
        raise StoreError("location が不正です", 400)

    try:
        with connect() as conn:
            with conn.cursor() as cur:
                member_id = _authenticate(cur, username, password)
                member = _fetch_member(cur, member_id)
                if member is None:
                    raise StoreError("ユーザーが見つかりません", 404)
                if member["graduation_year"] is not None:
                    raise StoreError("このユーザーは卒業しています", 400)

                if not _is_present(cur, member_id):
                    raise StoreError("在室中のみ作業を開始できます", 400)

                cur.execute(
                    """
                    SELECT id
                    FROM work_sessions
                    WHERE member_id = %s AND end_at IS NULL
                    """,
                    (member_id,),
                )
                if cur.fetchone():
                    return {
                        "ok": True,
                        "ignored": True,
                        "message": "すでに作業中です",
                    }

                cur.execute(
                    """
                    INSERT INTO work_sessions (member_id, location, start_at)
                    VALUES (%s, %s::work_location, now())
                    """,
                    (member_id, work_location),
                )
                conn.commit()
                return {
                    "ok": True,
                    "ignored": False,
                    "message": "作業開始を記録しました",
                }
    except StoreError:
        raise
    except Exception as exc:
        if is_unique_violation(exc):
            return {
                "ok": True,
                "ignored": True,
                "message": "すでに作業中です",
            }
        logger.exception("作業開始の記録に失敗しました")
        raise StoreError("作業開始の記録に失敗しました", 500) from exc


def end_work(username: str, password: str, *, end_at: Any = None) -> WorkResult:
    """
    作業セッションを終了する。
    end_at 省略時は now()。アイドル終了時はクライアントが最終操作時刻を渡す。

    open なセッションがあればそれを閉じる。
    無ければ（end_at 指定時のみ）最新セッションの end_at を書き換える。
    """
    parsed_end_at = _parse_end_at(end_at)

    try:
        with connect() as conn:
            with conn.cursor() as cur:
                member_id = _authenticate(cur, username, password)

                cur.execute(
                    """
                    SELECT id, start_at
                    FROM work_sessions
                    WHERE member_id = %s AND end_at IS NULL
                    ORDER BY start_at DESC
                    LIMIT 1
                    """,
                    (member_id,),
                )
                row = cur.fetchone()
                rewritten = False
                if not row:
                    # クラッシュ復帰などで、すでに閉じた最新セッションの終了時刻を補正する
                    if parsed_end_at is None:
                        return {
                            "ok": True,
                            "ignored": True,
                            "message": "作業中のセッションがありません",
                        }
                    cur.execute(
                        """
                        SELECT id, start_at
                        FROM work_sessions
                        WHERE member_id = %s
                        ORDER BY start_at DESC
                        LIMIT 1
                        """,
                        (member_id,),
                    )
                    row = cur.fetchone()
                    if not row:
                        return {
                            "ok": True,
                            "ignored": True,
                            "message": "作業セッションがありません",
                        }
                    rewritten = True

                session_id = int(row[0])
                start_at = _ensure_jst(row[1])
                effective_end = parsed_end_at if parsed_end_at is not None else datetime.now(JST)

                if effective_end < start_at:
                    raise StoreError("end_at は開始時刻以降である必要があります", 400)

                now = datetime.now(JST)
                if effective_end > now:
                    effective_end = now

                cur.execute(
                    """
                    UPDATE work_sessions
                    SET end_at = %s
                    WHERE id = %s
                    """,
                    (effective_end, session_id),
                )
                conn.commit()
                return {
                    "ok": True,
                    "ignored": False,
                    "message": (
                        "作業終了時刻を更新しました"
                        if rewritten
                        else "作業終了を記録しました"
                    ),
                }
    except StoreError:
        raise
    except Exception as exc:
        logger.exception("作業終了の記録に失敗しました")
        raise StoreError("作業終了の記録に失敗しました", 500) from exc
