"""PostgreSQL 接続と store 共通エラー。"""

from __future__ import annotations

from server.config import load_database_url


class StoreError(Exception):
    """store 層の論理エラー（API では message / status_code を返す）。"""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def require_database_url() -> str:
    """DATABASE_URL を返す。未設定なら StoreError(503)。"""
    database_url = load_database_url()
    if not database_url:
        raise StoreError("DATABASE_URL が未設定です", 503)
    return database_url


def connect():
    """psycopg 接続を開く。呼び出し側で with する。"""
    import psycopg

    return psycopg.connect(require_database_url())


def is_unique_violation(exc: Exception) -> bool:
    """一意制約違反かどうか。"""
    try:
        from psycopg.errors import UniqueViolation
    except ImportError:
        return False
    return isinstance(exc, UniqueViolation)
