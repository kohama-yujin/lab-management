"""roles テーブルから役職マスタを読み込む。"""

from __future__ import annotations

import logging
from typing import TypedDict

from server.config import load_database_url

logger = logging.getLogger(__name__)


class RoleItem(TypedDict):
    code: str
    name: str


# DATABASE_URL 未設定時のフォールバック（db/seed.sql と一致させる）
_FALLBACK_ROLES: tuple[RoleItem, ...] = (
    {"code": "member", "name": "一般"},
    {"code": "admin", "name": "管理者"},
)

_cached_roles: list[RoleItem] | None = None


def _fetch_roles_from_db() -> list[RoleItem]:
    database_url = load_database_url()
    if not database_url:
        return [dict(role) for role in _FALLBACK_ROLES]

    try:
        import psycopg
    except ImportError:
        logger.warning("psycopg が未インストールのためフォールバック役職を使用します")
        return [dict(role) for role in _FALLBACK_ROLES]

    try:
        with psycopg.connect(database_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT code, name FROM roles ORDER BY id ASC"
                )
                rows = cur.fetchall()
    except Exception:
        logger.exception("roles テーブルの読み込みに失敗したためフォールバック役職を使用します")
        return [dict(role) for role in _FALLBACK_ROLES]

    roles: list[RoleItem] = []
    for row in rows:
        if not row or not row[0]:
            continue
        roles.append({"code": str(row[0]), "name": str(row[1] or row[0])})

    if not roles:
        logger.warning("roles テーブルが空のためフォールバック役職を使用します")
        return [dict(role) for role in _FALLBACK_ROLES]
    return roles


def get_roles() -> list[RoleItem]:
    """役職一覧を返す。"""
    global _cached_roles
    if _cached_roles is None:
        _cached_roles = _fetch_roles_from_db()
    return [dict(role) for role in _cached_roles]


def invalidate_role_cache() -> None:
    """役職キャッシュを破棄する（マスタ更新後に呼ぶ）。"""
    global _cached_roles
    _cached_roles = None
