"""grades テーブルから学年マスタを読み込む。"""

from __future__ import annotations

import logging

from server.config import load_database_url

logger = logging.getLogger(__name__)

# DATABASE_URL 未設定時のフォールバック（db/seed.sql と一致させる）
_FALLBACK_GRADE_ORDER = ("Teacher", "M2", "M1", "B4", "other")

_cached_grade_order: list[str] | None = None


def _fetch_grade_order_from_db() -> list[str]:
    database_url = load_database_url()
    if not database_url:
        return list(_FALLBACK_GRADE_ORDER)

    try:
        import psycopg
    except ImportError:
        logger.warning("psycopg が未インストールのためフォールバック学年を使用します")
        return list(_FALLBACK_GRADE_ORDER)

    try:
        with psycopg.connect(database_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT code FROM grades ORDER BY sort_order ASC, id ASC"
                )
                rows = cur.fetchall()
    except Exception:
        logger.exception("grades テーブルの読み込みに失敗したためフォールバック学年を使用します")
        return list(_FALLBACK_GRADE_ORDER)

    codes = [str(row[0]) for row in rows if row and row[0]]
    if not codes:
        logger.warning("grades テーブルが空のためフォールバック学年を使用します")
        return list(_FALLBACK_GRADE_ORDER)
    return codes


def get_grade_order() -> list[str]:
    """表示順の学年 code 一覧を返す。"""
    global _cached_grade_order
    if _cached_grade_order is None:
        _cached_grade_order = _fetch_grade_order_from_db()
    return list(_cached_grade_order)


def invalidate_grade_cache() -> None:
    """学年キャッシュを破棄する（マスタ更新後に呼ぶ）。"""
    global _cached_grade_order
    _cached_grade_order = None


def normalize_grade_code(grade: str | None) -> str:
    """
    入力文字列を grades.code に正規化する。
    一致しない場合は other を返す（other が無い場合は末尾の学年）。
    """
    raw = (grade or "").strip()
    order = get_grade_order()
    known = set(order)

    if raw in known:
        return raw
    if raw.lower() == "teacher" and "Teacher" in known:
        return "Teacher"

    upper = raw.upper()
    if upper in known:
        return upper

    if "other" in known:
        return "other"
    return order[-1]
