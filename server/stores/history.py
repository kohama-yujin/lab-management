"""過去日（JST）の在室履歴。学年・役職・在学は変更イベントの日末時点を使う。"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta
from typing import Any

from server.db import StoreError, connect
from server.stores.grade import get_grade_order
from server.stores.status import (
    DayMemberRow,
    JST,
    _ensure_jst,
    aggregate_member_day,
)

logger = logging.getLogger(__name__)

_DAY_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def _parse_jst_day(day: str) -> date:
    """YYYY-MM-DD を JST 暦日として返す。"""
    match = _DAY_RE.match((day or "").strip())
    if not match:
        raise StoreError("日付は YYYY-MM-DD 形式で指定してください", 400)
    year, month, day_n = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
    try:
        return date(year, month, day_n)
    except ValueError as exc:
        raise StoreError("日付が不正です", 400) from exc


def _bounds_for_day(day: date) -> tuple[datetime, datetime]:
    """対象日の JST 0:00 と翌日 0:00 を返す。"""
    day_start = datetime(day.year, day.month, day.day, tzinfo=JST)
    return day_start, day_start + timedelta(days=1)


def _today_jst() -> date:
    return datetime.now(JST).date()


def _fetch_codes_as_of(
    cur,
    *,
    member_ids: list[int],
    day_end: datetime,
    changes_table: str,
    to_column: str,
    master_table: str,
) -> dict[int, str]:
    """変更イベントから、day_end 直前までの最新 code をメンバーごとに返す。"""
    if not member_ids:
        return {}
    cur.execute(
        f"""
        SELECT DISTINCT ON (c.member_id)
            c.member_id,
            m.code
        FROM {changes_table} c
        JOIN {master_table} m ON m.id = c.{to_column}
        WHERE c.member_id = ANY(%s)
          AND c.created_at < %s
        ORDER BY c.member_id, c.created_at DESC, c.id DESC
        """,
        (member_ids, day_end),
    )
    return {int(row[0]): str(row[1]) for row in cur.fetchall()}


def _fetch_grade_codes_as_of(cur, member_ids: list[int], day_end: datetime) -> dict[int, str]:
    """学年を日末時点で解決する。"""
    return _fetch_codes_as_of(
        cur,
        member_ids=member_ids,
        day_end=day_end,
        changes_table="member_grade_changes",
        to_column="grade_id_to",
        master_table="grades",
    )


def _fetch_role_codes_as_of(cur, member_ids: list[int], day_end: datetime) -> dict[int, str]:
    """役職を日末時点で解決する。"""
    return _fetch_codes_as_of(
        cur,
        member_ids=member_ids,
        day_end=day_end,
        changes_table="member_role_changes",
        to_column="role_id_to",
        master_table="roles",
    )


def _fetch_graduation_years_as_of(
    cur, member_ids: list[int], day_end: datetime
) -> dict[int, int | None]:
    """
    卒業年度を日末時点で解決する。
    値が NULL なら在学。変更行が無いメンバーは含めない。
    """
    if not member_ids:
        return {}
    cur.execute(
        """
        SELECT DISTINCT ON (c.member_id)
            c.member_id,
            c.graduation_year_to
        FROM member_graduation_changes c
        WHERE c.member_id = ANY(%s)
          AND c.created_at < %s
        ORDER BY c.member_id, c.created_at DESC, c.id DESC
        """,
        (member_ids, day_end),
    )
    result: dict[int, int | None] = {}
    for row in cur.fetchall():
        year = row[1]
        result[int(row[0])] = int(year) if year is not None else None
    return result


def _fallback_current_grades(cur, member_ids: list[int]) -> dict[int, str]:
    """変更行が無いメンバー向けに、現在の学年 code を返す。"""
    if not member_ids:
        return {}
    cur.execute(
        """
        SELECT m.id, g.code
        FROM members m
        JOIN grades g ON g.id = m.grade_id
        WHERE m.id = ANY(%s)
        """,
        (member_ids,),
    )
    return {int(row[0]): str(row[1]) for row in cur.fetchall()}


def _fallback_current_graduation(cur, member_ids: list[int]) -> dict[int, int | None]:
    """卒業変更行が無いメンバー向けに、現在の graduation_year を返す。"""
    if not member_ids:
        return {}
    cur.execute(
        "SELECT id, graduation_year FROM members WHERE id = ANY(%s)",
        (member_ids,),
    )
    result: dict[int, int | None] = {}
    for row in cur.fetchall():
        year = row[1]
        result[int(row[0])] = int(year) if year is not None else None
    return result


def _enrolled_grades_as_of(cur, day_end: datetime) -> tuple[list[str], dict[int, tuple[str, str]]]:
    """
    日末時点で在学だったメンバーの学年から、ボード対象学年と
    member_id → (name, grade) を返す。
    """
    cur.execute("SELECT id, name FROM members ORDER BY name ASC")
    everyone = [(int(row[0]), str(row[1])) for row in cur.fetchall()]
    member_ids = [item[0] for item in everyone]

    graduation_as_of = _fetch_graduation_years_as_of(cur, member_ids, day_end)
    missing_grad = [mid for mid in member_ids if mid not in graduation_as_of]
    if missing_grad:
        graduation_as_of.update(_fallback_current_graduation(cur, missing_grad))

    enrolled = [
        (member_id, name)
        for member_id, name in everyone
        if member_id in graduation_as_of and graduation_as_of[member_id] is None
    ]
    enrolled_ids = [item[0] for item in enrolled]
    as_of = _fetch_grade_codes_as_of(cur, enrolled_ids, day_end)
    missing = [mid for mid in enrolled_ids if mid not in as_of]
    if missing:
        as_of.update(_fallback_current_grades(cur, missing))

    members: dict[int, tuple[str, str]] = {}
    grade_set: set[str] = set()
    for member_id, name in enrolled:
        grade = as_of.get(member_id)
        if not grade:
            continue
        members[member_id] = (name, grade)
        grade_set.add(grade)

    order = get_grade_order()
    index = {code: i for i, code in enumerate(order)}
    grades = sorted(grade_set, key=lambda code: index.get(code, len(order)))
    return grades, members


def list_history_dates() -> list[str]:
    """
    在室セッションが1件以上重なる JST 日付（当日より前）を新しい順で返す。
    誰も来ていない日は含めない。
    """
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT DISTINCT gs::date AS day
                    FROM attendance_sessions s
                    CROSS JOIN LATERAL generate_series(
                        (s.start_at AT TIME ZONE 'Asia/Tokyo')::date,
                        (
                            COALESCE(s.end_at, CLOCK_TIMESTAMP())
                            AT TIME ZONE 'Asia/Tokyo'
                        )::date,
                        INTERVAL '1 day'
                    ) AS gs
                    WHERE gs::date < (CLOCK_TIMESTAMP() AT TIME ZONE 'Asia/Tokyo')::date
                    ORDER BY day DESC
                    """
                )
                return [row[0].isoformat() for row in cur.fetchall()]
    except StoreError:
        raise
    except Exception as exc:
        logger.exception("履歴日付一覧の取得に失敗しました")
        raise StoreError("履歴日付一覧の取得に失敗しました", 500) from exc


def get_history_for_day(day: str) -> dict[str, Any] | None:
    """
    指定 JST 日の履歴ボード用ペイロードを返す。
    当日・未来・セッション無しは None（404）。
    """
    target = _parse_jst_day(day)
    if target >= _today_jst():
        return None

    day_start, day_end = _bounds_for_day(target)

    try:
        with connect() as conn:
            with conn.cursor() as cur:
                grades, enrolled = _enrolled_grades_as_of(cur, day_end)
                cur.execute(
                    """
                    SELECT
                        s.id,
                        m.id AS member_id,
                        m.name,
                        s.start_at,
                        s.end_at
                    FROM attendance_sessions s
                    JOIN members m ON m.id = s.member_id
                    WHERE s.start_at < %s
                      AND (s.end_at IS NULL OR s.end_at > %s)
                    ORDER BY m.name ASC, s.start_at ASC
                    """,
                    (day_end, day_start),
                )
                rows = cur.fetchall()
                role_as_of = _fetch_role_codes_as_of(cur, list(enrolled.keys()), day_end)
    except StoreError:
        raise
    except Exception as exc:
        logger.exception("在室履歴の取得に失敗しました")
        raise StoreError("在室履歴の取得に失敗しました", 500) from exc

    if not rows:
        return None

    grouped: dict[int, dict[str, Any]] = {}
    ordered_ids: list[int] = []
    for row in rows:
        member_id = int(row[1])
        if member_id not in enrolled:
            continue
        if member_id not in grouped:
            grouped[member_id] = {
                "name": enrolled[member_id][0],
                "grade": enrolled[member_id][1],
                "role": role_as_of.get(member_id),
                "sessions": [],
            }
            ordered_ids.append(member_id)
        start_at = _ensure_jst(row[3])
        end_at = _ensure_jst(row[4]) if row[4] is not None else day_end
        grouped[member_id]["sessions"].append((start_at, end_at))

    by_grade: dict[str, list[DayMemberRow]] = {grade: [] for grade in grades}
    count = 0

    for member_id in ordered_ids:
        item = grouped[member_id]
        member_row = aggregate_member_day(
            member_id=member_id,
            name=item["name"],
            grade=item["grade"],
            sessions=item["sessions"],
            day_start=day_start,
            day_end=day_end,
            now=day_end,
        )
        if member_row is None:
            continue
        grade = member_row["grade"]
        if grade not in by_grade:
            continue
        # 過去日は在室中表示にしない
        member_row["present"] = False
        member_row["role"] = item.get("role")
        by_grade[grade].append(member_row)
        count += 1

    # セッションはあるが日末時点で全員卒業などでも、日付一覧に載る日は空ボードを返す
    return {
        "day": target.isoformat(),
        "grades": grades,
        "by_grade": by_grade,
        "count": count,
    }
