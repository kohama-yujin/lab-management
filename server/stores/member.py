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
from server.password_utils import hash_password, verify_password
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


def _insert_grade_change(
    cur,
    member_id: int,
    grade_id_from: int | None,
    grade_id_to: int,
) -> None:
    """学年変更イベントを1行追記する。登録時は grade_id_from を NULL にする。"""
    cur.execute(
        """
        INSERT INTO member_grade_changes (member_id, grade_id_from, grade_id_to)
        VALUES (%s, %s, %s)
        """,
        (member_id, grade_id_from, grade_id_to),
    )


def _insert_role_change(
    cur,
    member_id: int,
    role_id_from: int | None,
    role_id_to: int,
) -> None:
    """役職変更イベントを1行追記する。登録時は role_id_from を NULL にする。"""
    cur.execute(
        """
        INSERT INTO member_role_changes (member_id, role_id_from, role_id_to)
        VALUES (%s, %s, %s)
        """,
        (member_id, role_id_from, role_id_to),
    )


def _insert_graduation_change(
    cur,
    member_id: int,
    graduation_year_from: int | None,
    graduation_year_to: int | None,
) -> None:
    """
    卒業状態の変更イベントを1行追記する。
    graduation_year_* が NULL なら在学。登録時は from/to とも NULL。
    """
    cur.execute(
        """
        INSERT INTO member_graduation_changes (
            member_id, graduation_year_from, graduation_year_to
        )
        VALUES (%s, %s, %s)
        """,
        (member_id, graduation_year_from, graduation_year_to),
    )


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


def _ensure_active_admin_remains(
    cur,
    *,
    member_id: int,
    new_role_id: int,
    new_graduation_year: int | None,
) -> None:
    """
    更新後も在学中（graduation_year IS NULL）の管理者が1人以上残ることを保証する。
    卒業済みメンバーは対象外。
    """
    cur.execute("SELECT id FROM roles WHERE code = %s", ("admin",))
    admin_row = cur.fetchone()
    if not admin_row:
        raise StoreError("役職 'admin' が見つかりません", 500)
    admin_role_id = int(admin_row[0])

    # 自分以外の在学中管理者
    cur.execute(
        """
        SELECT COUNT(*) FROM members
        WHERE role_id = %s
          AND graduation_year IS NULL
          AND id <> %s
        """,
        (admin_role_id, member_id),
    )
    count_row = cur.fetchone()
    other_active_admins = int(count_row[0]) if count_row else 0

    self_is_active_admin = (
        new_role_id == admin_role_id and new_graduation_year is None
    )
    if other_active_admins + (1 if self_is_active_admin else 0) < 1:
        raise StoreError(
            "在学中の管理者が0人になるため、この変更はできません",
            400,
        )


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


def fetch_member_by_credentials(username: str, password: str) -> MemberItem:
    """認証情報からメンバーを取得する。"""
    if not username:
        raise StoreError("ユーザーIDは必須です", 400)
    if not password:
        raise StoreError("パスワードは必須です", 400)
    normalized = _normalize_username(username)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, password_hash FROM members WHERE username = %s",
                (normalized,),
            )
            row = cur.fetchone()
            if not row or not verify_password(password, str(row[1])):
                raise StoreError("ユーザーIDまたはパスワードが間違っています", 401)

            member = _fetch_member(cur, int(row[0]))
            if member is None:
                raise StoreError("ユーザーIDまたはパスワードが間違っています", 401)
            return member


def fetch_member_by_id(member_id: int) -> MemberItem | None:
    """ID からメンバーを取得する。"""
    with connect() as conn:
        with conn.cursor() as cur:
            return _fetch_member(cur, member_id)


def fetch_slack_user_id_by_member_id(member_id: int) -> str | None:
    """メンバー ID から Slack ユーザー ID を返す。未設定なら None。"""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT slack_user_id FROM members WHERE id = %s",
                (member_id,),
            )
            row = cur.fetchone()
            if not row or row[0] is None:
                return None
            value = str(row[0]).strip()
            return value or None


def fetch_member_by_slack_user_id(slack_user_id: str) -> MemberItem | None:
    """Slack ユーザー ID からメンバーを取得する。"""
    normalized = (slack_user_id or "").strip()
    if not normalized:
        return None

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"{_MEMBER_SELECT} WHERE m.slack_user_id = %s",
                (normalized,),
            )
            row = cur.fetchone()
            if not row:
                return None
            return _row_to_member(row)


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
                ORDER BY
                    m.graduation_year DESC,
                    g.sort_order ASC,
                    m.updated_at DESC,
                    m.name ASC
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
    slack_user_id: str | None = None,
) -> MemberItem:
    """メンバーを新規登録する。slack_user_id は自己登録時のみ渡す。"""
    normalized_name = _normalize_name(name)
    normalized_username = _normalize_username(username)
    _validate_password(password, required=True)
    normalized_slack = (slack_user_id or "").strip() or None

    try:
        with connect() as conn:
            with conn.cursor() as cur:
                grade_id = _resolve_grade_id(cur, grade)
                role_id = _resolve_role_id(cur, role)
                password_hash = hash_password(password)

                cur.execute(
                    """
                    INSERT INTO members (
                        username, password_hash, name, role_id, grade_id,
                        graduation_year, slack_user_id
                    )
                    VALUES (%s, %s, %s, %s, %s, NULL, %s)
                    RETURNING id
                    """,
                    (
                        normalized_username,
                        password_hash,
                        normalized_name,
                        role_id,
                        grade_id,
                        normalized_slack,
                    ),
                )
                inserted = cur.fetchone()
                if not inserted:
                    raise StoreError("メンバーの登録に失敗しました", 500)

                member_id = int(inserted[0])
                _insert_grade_change(cur, member_id, None, grade_id)
                _insert_role_change(cur, member_id, None, role_id)
                _insert_graduation_change(cur, member_id, None, None)

                member = _fetch_member(cur, member_id)
                if not member:
                    raise StoreError("登録したメンバーの取得に失敗しました", 500)
                conn.commit()
                return member
    except StoreError:
        raise
    except Exception as exc:
        if is_unique_violation(exc):
            raise StoreError("このユーザーIDは既に使われています", 409) from exc
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
                cur.execute(
                    "SELECT grade_id, role_id, graduation_year FROM members WHERE id = %s",
                    (member_id,),
                )
                current = cur.fetchone()
                if not current:
                    raise StoreError("メンバーが見つかりません", 404)

                old_grade_id = int(current[0])
                old_role_id = int(current[1])
                old_graduation_year = int(current[2]) if current[2] is not None else None
                grade_id = _resolve_grade_id(cur, grade)
                role_id = _resolve_role_id(cur, role)
                _ensure_active_admin_remains(
                    cur,
                    member_id=member_id,
                    new_role_id=role_id,
                    new_graduation_year=normalized_graduation_year,
                )

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

                if grade_id != old_grade_id:
                    _insert_grade_change(cur, member_id, old_grade_id, grade_id)
                if role_id != old_role_id:
                    _insert_role_change(cur, member_id, old_role_id, role_id)
                if normalized_graduation_year != old_graduation_year:
                    _insert_graduation_change(
                        cur,
                        member_id,
                        old_graduation_year,
                        normalized_graduation_year,
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
            raise StoreError("このユーザーIDは既に使われています", 409) from exc
        logger.exception("メンバー更新に失敗しました")
        raise StoreError("メンバーの更新に失敗しました", 500) from exc
