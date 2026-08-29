"""members テーブルの読み書き。"""

from __future__ import annotations

import logging
from typing import TypedDict

from server.db import StoreError, connect, is_unique_violation
from server.member_validation import (
    MemberValidationError,
    normalize_name,
    normalize_username,
    validate_password,
)
from server.password_utils import hash_password
from server.stores.grade import normalize_grade_code
from server.stores.role import get_roles

logger = logging.getLogger(__name__)


class MemberItem(TypedDict):
    id: int
    name: str
    grade: str
    username: str
    role: str
    graduation_year: int | None


_MEMBER_SELECT = """
SELECT
    m.id,
    m.username,
    m.name,
    g.code AS grade,
    r.code AS role,
    m.graduation_year
FROM members m
JOIN grades g ON g.id = m.grade_id
JOIN roles r ON r.id = m.role_id
"""


def _row_to_member(row: tuple) -> MemberItem:
    graduation_year = row[5]
    return {
        "id": int(row[0]),
        "username": str(row[1]),
        "name": str(row[2]),
        "grade": str(row[3]),
        "role": str(row[4]),
        "graduation_year": int(graduation_year) if graduation_year is not None else None,
    }


def _fetch_member(cur, member_id: int) -> MemberItem | None:
    cur.execute(
        f"{_MEMBER_SELECT} WHERE m.id = %s",
        (member_id,),
    )
    row = cur.fetchone()
    if not row:
        return None
    return _row_to_member(row)


def _resolve_grade_id(cur, grade_code: str) -> int:
    normalized = normalize_grade_code(grade_code)
    cur.execute("SELECT id FROM grades WHERE code = %s", (normalized,))
    row = cur.fetchone()
    if not row:
        raise StoreError(f"学年 '{normalized}' が見つかりません", 400)
    return int(row[0])


def _resolve_role_id(cur, role_code: str) -> int:
    code = (role_code or "").strip()
    known = {role["code"] for role in get_roles()}
    if code not in known:
        raise StoreError(f"役職 '{code}' が無効です", 400)

    cur.execute("SELECT id FROM roles WHERE code = %s", (code,))
    row = cur.fetchone()
    if not row:
        raise StoreError(f"役職 '{code}' が見つかりません", 400)
    return int(row[0])


def _normalize_username(username: str) -> str:
    try:
        return normalize_username(username)
    except MemberValidationError as exc:
        raise StoreError(exc.message, exc.status_code) from exc


def _normalize_name(name: str) -> str:
    try:
        return normalize_name(name)
    except MemberValidationError as exc:
        raise StoreError(exc.message, exc.status_code) from exc


def _validate_password(password: str, *, required: bool) -> None:
    try:
        validate_password(password, required=required)
    except MemberValidationError as exc:
        raise StoreError(exc.message, exc.status_code) from exc


def _normalize_graduation_year(value: int | None) -> int | None:
    if value is None:
        return None
    if value < 2000 or value > 2100:
        raise StoreError("graduation_year は 2000〜2100 の範囲で指定してください", 400)
    return value


def list_active_members() -> list[MemberItem]:
    """在学中メンバー一覧を返す。"""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"{_MEMBER_SELECT} WHERE m.graduation_year IS NULL ORDER BY g.sort_order ASC, m.name ASC"
            )
            return [_row_to_member(row) for row in cur.fetchall()]


def list_graduated_members(offset: int, limit: int) -> tuple[list[MemberItem], int]:
    """卒業済みメンバーをページ取得する。"""
    if offset < 0:
        offset = 0
    if limit < 1:
        limit = 1
    if limit > 100:
        limit = 100

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM members WHERE graduation_year IS NOT NULL"
            )
            total_row = cur.fetchone()
            total = int(total_row[0]) if total_row else 0

            cur.execute(
                f"""
                {_MEMBER_SELECT}
                WHERE m.graduation_year IS NOT NULL
                ORDER BY m.graduation_year DESC, g.sort_order ASC, m.name ASC
                OFFSET %s LIMIT %s
                """,
                (offset, limit),
            )
            items = [_row_to_member(row) for row in cur.fetchall()]
            return items, total


def create_member(
    *,
    name: str,
    grade: str,
    role: str,
    username: str,
    password: str,
) -> MemberItem:
    """メンバーを新規登録する。"""
    normalized_name = _normalize_name(name)
    normalized_username = _normalize_username(username)
    _validate_password(password, required=True)

    try:
        with connect() as conn:
            with conn.cursor() as cur:
                grade_id = _resolve_grade_id(cur, grade)
                role_id = _resolve_role_id(cur, role)
                password_hash = hash_password(password)

                cur.execute(
                    """
                    INSERT INTO members (
                        username, password_hash, name, role_id, grade_id, graduation_year
                    )
                    VALUES (%s, %s, %s, %s, %s, NULL)
                    RETURNING id
                    """,
                    (
                        normalized_username,
                        password_hash,
                        normalized_name,
                        role_id,
                        grade_id,
                    ),
                )
                inserted = cur.fetchone()
                if not inserted:
                    raise StoreError("メンバーの登録に失敗しました", 500)

                member = _fetch_member(cur, int(inserted[0]))
                if not member:
                    raise StoreError("登録したメンバーの取得に失敗しました", 500)
                conn.commit()
                return member
    except StoreError:
        raise
    except Exception as exc:
        if is_unique_violation(exc):
            raise StoreError("このユーザー名は既に使われています", 409) from exc
        logger.exception("メンバー登録に失敗しました")
        raise StoreError("メンバーの登録に失敗しました", 500) from exc


def update_member(
    member_id: int,
    *,
    name: str,
    grade: str,
    role: str,
    username: str,
    password: str | None,
    graduation_year: int | None,
) -> MemberItem:
    """メンバー情報を更新する。"""
    normalized_name = _normalize_name(name)
    normalized_username = _normalize_username(username)
    normalized_graduation_year = _normalize_graduation_year(graduation_year)
    if password:
        _validate_password(password, required=False)

    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM members WHERE id = %s", (member_id,))
                if not cur.fetchone():
                    raise StoreError("メンバーが見つかりません", 404)

                grade_id = _resolve_grade_id(cur, grade)
                role_id = _resolve_role_id(cur, role)

                if password:
                    cur.execute(
                        """
                        UPDATE members
                        SET username = %s,
                            password_hash = %s,
                            name = %s,
                            role_id = %s,
                            grade_id = %s,
                            graduation_year = %s,
                            updated_at = now()
                        WHERE id = %s
                        """,
                        (
                            normalized_username,
                            hash_password(password),
                            normalized_name,
                            role_id,
                            grade_id,
                            normalized_graduation_year,
                            member_id,
                        ),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE members
                        SET username = %s,
                            name = %s,
                            role_id = %s,
                            grade_id = %s,
                            graduation_year = %s,
                            updated_at = now()
                        WHERE id = %s
                        """,
                        (
                            normalized_username,
                            normalized_name,
                            role_id,
                            grade_id,
                            normalized_graduation_year,
                            member_id,
                        ),
                    )

                member = _fetch_member(cur, member_id)
                if not member:
                    raise StoreError("更新したメンバーの取得に失敗しました", 500)
                conn.commit()
                return member
    except StoreError:
        raise
    except Exception as exc:
        if is_unique_violation(exc):
            raise StoreError("このユーザー名は既に使われています", 409) from exc
        logger.exception("メンバー更新に失敗しました")
        raise StoreError("メンバーの更新に失敗しました", 500) from exc
