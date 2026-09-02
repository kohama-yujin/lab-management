"""attendance_sessions テーブルの在室・不在登録。"""

from __future__ import annotations

import logging
from typing import TypedDict

from server.db import StoreError, connect, is_unique_violation
from server.password_utils import verify_password
from server.stores.member import _fetch_member

logger = logging.getLogger(__name__)


class AttendanceResult(TypedDict):
    ok: bool
    message: str
    ignored: bool


def _authenticate(cur, username: str, password: str) -> int:
    """username / password を照合し、members.id を返す。"""
    normalized = (username or "").strip()
    if not normalized:
        raise StoreError("ユーザーIDは必須です", 400)
    if not password:
        raise StoreError("パスワードは必須です", 400)

    cur.execute(
        "SELECT id, password_hash FROM members WHERE username = %s",
        (normalized,),
    )
    row = cur.fetchone()
    if not row:
        raise StoreError("ユーザーが見つかりません", 404)

    member_id = int(row[0])
    password_hash = str(row[1])
    if not verify_password(password, password_hash):
        raise StoreError("パスワードが正しくありません", 401)
    return member_id


def start_attendance(username: str, password: str) -> AttendanceResult:
    """在室セッションを開始する。既に在室中なら ignored で成功扱い。"""
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                member_id = _authenticate(cur, username, password)
                member = _fetch_member(cur, member_id)
                if member is None:
                    raise StoreError("ユーザーが見つかりません", 404)
                if member["graduation_year"] is not None:
                    raise StoreError("このユーザーは卒業しています", 400)

                cur.execute(
                    """
                    SELECT id
                    FROM attendance_sessions
                    WHERE member_id = %s AND end_at IS NULL
                    """,
                    (member_id,),
                )
                if cur.fetchone():
                    return {
                        "ok": True,
                        "ignored": True,
                        "message": "すでに在室中です",
                    }

                cur.execute(
                    """
                    INSERT INTO attendance_sessions (member_id, start_at)
                    VALUES (%s, now())
                    """,
                    (member_id,),
                )
                conn.commit()
                return {
                    "ok": True,
                    "ignored": False,
                    "message": "在室登録が完了しました",
                }
    except StoreError:
        raise
    except Exception as exc:
        if is_unique_violation(exc):
            # 同時リクエストでユニーク制約に当たった場合も在室中扱い
            return {
                "ok": True,
                "ignored": True,
                "message": "すでに在室中です",
            }
        logger.exception("在室登録に失敗しました")
        raise StoreError("在室登録に失敗しました", 500) from exc


def _close_open_work_sessions(cur, member_id: int) -> None:
    """open な work_sessions を now() で閉じる。"""
    cur.execute(
        """
        UPDATE work_sessions
        SET end_at = now()
        WHERE member_id = %s AND end_at IS NULL
        """,
        (member_id,),
    )


def end_attendance(username: str, password: str) -> AttendanceResult:
    """
    在室セッションを終了する。
    start_at の日付は見ず、end_at IS NULL の行を閉じる（日付またぎ対応）。
    開いている在室が無くても、open な work_sessions は常に閉じる。
    """
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                member_id = _authenticate(cur, username, password)

                # 日付条件を付けないことで、前日開始の在室も不在登録できる
                cur.execute(
                    """
                    UPDATE attendance_sessions
                    SET end_at = now()
                    WHERE id = (
                        SELECT id
                        FROM attendance_sessions
                        WHERE member_id = %s AND end_at IS NULL
                        ORDER BY start_at DESC
                        LIMIT 1
                    )
                    RETURNING id
                    """,
                    (member_id,),
                )
                closed = cur.fetchone()
                _close_open_work_sessions(cur, member_id)
                conn.commit()
                if not closed:
                    return {
                        "ok": True,
                        "ignored": True,
                        "message": "すでに不在です",
                    }

                return {
                    "ok": True,
                    "ignored": False,
                    "message": "不在登録が完了しました",
                }
    except StoreError:
        raise
    except Exception as exc:
        logger.exception("不在登録に失敗しました")
        raise StoreError("不在登録に失敗しました", 500) from exc
