"""当日（JST）の在室ボード用ステータス集計。"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, TypedDict
from zoneinfo import ZoneInfo

from server.db import StoreError, connect
from server.stores.grade import get_grades_with_enrolled_members

logger = logging.getLogger(__name__)

JST = ZoneInfo("Asia/Tokyo")


class DayAttendanceSessionClip(TypedDict):
    """当日にクリップした在室セッション1本。"""

    start_at: str
    end_at: str | None
    raw_start_at: str
    raw_end_at: str | None
    end_at_is_now: bool
    end_at_is_end_of_day: bool
    starts_from_previous_day: bool
    duration_seconds: int


class DayMemberRow(TypedDict):
    member_id: int
    name: str
    grade: str
    present: bool
    arrived_at: str | None
    left_at: str | None
    left_at_is_end_of_day: bool
    arrived_from_previous_day: bool
    left_into_next_day: bool
    total_present_seconds: int
    attendance_session_count: int
    attendance_sessions: list[DayAttendanceSessionClip]
    working: bool
    work_started_at: str | None
    total_work_seconds: int
    work_session_count: int
    work_sessions: list[DayAttendanceSessionClip]


def _day_bounds(*, now: datetime | None = None) -> tuple[datetime, datetime, datetime]:
    """JST の now / day_start / day_end（翌日 0:00）を返す。"""
    current = now.astimezone(JST) if now is not None else datetime.now(JST)
    day_start = datetime(current.year, current.month, current.day, tzinfo=JST)
    day_end = day_start + timedelta(days=1)
    return current, day_start, day_end


def _to_iso(value: datetime) -> str:
    return value.astimezone(JST).isoformat()


def _ensure_jst(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=JST)
    return value.astimezone(JST)


def _clip_day_sessions(
    sessions: list[tuple[datetime, datetime | None]],
    *,
    day_start: datetime,
    day_end: datetime,
    now: datetime,
) -> tuple[list[DayAttendanceSessionClip], bool, list[datetime], list[datetime]]:
    """
    セッション列を当日 JST 範囲でクリップする。
    戻り値は (クリップ一覧, 未終了セッションがあるか, 重なった開始, 重なった終了)。
    """
    clips: list[DayAttendanceSessionClip] = []
    has_open = False
    raw_starts: list[datetime] = []
    raw_ends: list[datetime] = []

    for start_at, end_at in sessions:
        start_at = _ensure_jst(start_at)
        end_at = _ensure_jst(end_at) if end_at is not None else None
        open_session = end_at is None
        if open_session:
            has_open = True
        effective_end = end_at if end_at is not None else now
        clip_start = max(start_at, day_start)
        clip_end = min(effective_end, day_end)
        if clip_end <= clip_start:
            continue

        end_at_is_end_of_day = (not open_session) and end_at is not None and end_at >= day_end
        starts_from_previous_day = start_at < day_start

        if open_session:
            display_end = clip_end
            end_at_is_now = True
        elif end_at_is_end_of_day:
            display_end = day_end
            end_at_is_now = False
        else:
            display_end = clip_end
            end_at_is_now = False

        duration = int((clip_end - clip_start).total_seconds())
        clips.append(
            {
                "start_at": _to_iso(clip_start),
                "end_at": _to_iso(display_end),
                "raw_start_at": _to_iso(start_at),
                "raw_end_at": _to_iso(end_at) if end_at is not None else None,
                "end_at_is_now": end_at_is_now,
                "end_at_is_end_of_day": end_at_is_end_of_day,
                "starts_from_previous_day": starts_from_previous_day,
                "duration_seconds": max(0, duration),
            }
        )
        raw_starts.append(start_at)
        if end_at is not None:
            raw_ends.append(end_at)

    return clips, has_open, raw_starts, raw_ends


def _aggregate_attendance_fields(
    attendance_sessions: list[tuple[datetime, datetime | None]],
    *,
    day_start: datetime,
    day_end: datetime,
    now: datetime,
) -> dict[str, Any] | None:
    """1メンバー分の在室フィールドを集計する。当日と重ならなければ None。"""
    clips, present, raw_starts, raw_ends = _clip_day_sessions(
        attendance_sessions,
        day_start=day_start,
        day_end=day_end,
        now=now,
    )
    if not clips:
        return None

    first_start = min(raw_starts)
    arrived_from_previous_day = first_start < day_start
    arrived_at = day_start if arrived_from_previous_day else first_start

    left_at: datetime | None = None
    left_at_is_end_of_day = False
    if not present:
        last_end = max(raw_ends)
        if last_end >= day_end:
            left_at = day_end
            left_at_is_end_of_day = True
        else:
            left_at = last_end

    return {
        "present": present,
        "arrived_at": _to_iso(arrived_at),
        "left_at": _to_iso(left_at) if left_at is not None else None,
        "left_at_is_end_of_day": left_at_is_end_of_day,
        "arrived_from_previous_day": arrived_from_previous_day,
        "left_into_next_day": left_at_is_end_of_day,
        "total_present_seconds": sum(clip["duration_seconds"] for clip in clips),
        "attendance_session_count": len(clips),
        "attendance_sessions": clips,
    }


def _aggregate_work_fields(
    work_sessions: list[tuple[datetime, datetime | None]],
    *,
    day_start: datetime,
    day_end: datetime,
    now: datetime,
) -> dict[str, Any]:
    """1メンバー分の作業フィールドを集計する。"""
    clips, working, _, _ = _clip_day_sessions(
        work_sessions,
        day_start=day_start,
        day_end=day_end,
        now=now,
    )
    if not clips:
        return {
            "working": False,
            "work_started_at": None,
            "total_work_seconds": 0,
            "work_session_count": 0,
            "work_sessions": [],
        }

    work_started_at: str | None = None
    if working:
        for start_at, end_at in work_sessions:
            if end_at is None:
                work_started_at = _to_iso(_ensure_jst(start_at))
                break

    return {
        "working": working,
        "work_started_at": work_started_at,
        "total_work_seconds": sum(clip["duration_seconds"] for clip in clips),
        "work_session_count": len(clips),
        "work_sessions": clips,
    }


def aggregate_member_day(
    *,
    member_id: int,
    name: str,
    grade: str,
    attendance_sessions: list[tuple[datetime, datetime | None]],
    work_sessions: list[tuple[datetime, datetime | None]] | None = None,
    day_start: datetime,
    day_end: datetime,
    now: datetime,
) -> DayMemberRow | None:
    """
    1メンバー分の当日表示を集計する。
    attendance_sessions: (start_at, end_at)。当日と重ならなければ None。
    work_sessions: 作業セッション。在室と同様に当日クリップして付与する。
    """
    attendance_fields = _aggregate_attendance_fields(
        attendance_sessions,
        day_start=day_start,
        day_end=day_end,
        now=now,
    )
    if attendance_fields is None:
        return None

    work_fields = _aggregate_work_fields(
        work_sessions or [],
        day_start=day_start,
        day_end=day_end,
        now=now,
    )

    return {
        "member_id": member_id,
        "name": name,
        "grade": grade,
        **attendance_fields,
        **work_fields,
    }


def _build_revision(
    attendance_session_rows: list[tuple[Any, ...]],
    work_session_rows: list[tuple[Any, ...]],
    now: datetime,
) -> int:
    """
    在室・作業セッション変化と「分」の進行を検知する revision。
    minute_bucket は必ず1回だけ混ぜる（在室中が偶数人だと XOR が打ち消し合うため）。
    """
    minute_bucket = int(now.timestamp()) // 60
    if not attendance_session_rows and not work_session_rows:
        return minute_bucket & 0x7FFFFFFF

    revision = (len(attendance_session_rows) + len(work_session_rows)) * 1_000_000
    for row in attendance_session_rows:
        session_id = int(row[0])
        end_at = row[5]
        revision ^= session_id * 1_000_003
        if end_at is not None:
            revision ^= int(end_at.timestamp())
        else:
            revision ^= 7
    for row in work_session_rows:
        session_id = int(row[0])
        end_at = row[3]
        revision ^= session_id * 1_000_009
        if end_at is not None:
            revision ^= int(end_at.timestamp())
        else:
            revision ^= 11
    revision ^= minute_bucket
    return revision & 0x7FFFFFFF


def _arrival_sort_key(row: DayMemberRow) -> tuple[int, str, str, int]:
    """学年内の並び: 在室 → 到着時刻 → 名前 → member_id。"""
    return (
        0 if row["present"] else 1,
        row["arrived_at"] or "",
        row["name"],
        row["member_id"],
    )


def get_today_status() -> dict[str, Any]:
    """
    JST 本日の在室ボード用ペイロードを返す。
    学年内メンバーは在室優先のうえ、到着時刻（arrived_at）の昇順。
    public_url はルート側で付与する。
    """
    # 在学生がいる学年のみボード表示する（当日未出勤でも空ボードは出す）
    grades = get_grades_with_enrolled_members()
    now, day_start, day_end = _day_bounds()

    try:
        with connect() as conn:
            with conn.cursor() as cur:
                # 当日 [day_start, day_end) と重なる在室セッション
                cur.execute(
                    """
                    SELECT
                        s.id,
                        m.id AS member_id,
                        m.name,
                        g.code AS grade,
                        s.start_at,
                        s.end_at
                    FROM attendance_sessions s
                    JOIN members m ON m.id = s.member_id
                    JOIN grades g ON g.id = m.grade_id
                    WHERE s.start_at < %s
                      AND (s.end_at IS NULL OR s.end_at > %s)
                    ORDER BY s.start_at ASC, m.id ASC
                    """,
                    (day_end, day_start),
                )
                rows = cur.fetchall()
                # 当日 [day_start, day_end) と重なる作業セッション
                cur.execute(
                    """
                    SELECT
                        s.id,
                        s.member_id,
                        s.start_at,
                        s.end_at
                    FROM work_sessions s
                    WHERE s.start_at < %s
                      AND (s.end_at IS NULL OR s.end_at > %s)
                    ORDER BY s.start_at ASC, s.member_id ASC
                    """,
                    (day_end, day_start),
                )
                work_rows = cur.fetchall()
    except StoreError:
        raise
    except Exception as exc:
        logger.exception("在室ステータスの取得に失敗しました")
        raise StoreError("在室ステータスの取得に失敗しました", 500) from exc

    grouped: dict[int, dict[str, Any]] = {}
    ordered_ids: list[int] = []

    for row in rows:
        member_id = int(row[1])
        if member_id not in grouped:
            grouped[member_id] = {
                "name": str(row[2]),
                "grade": str(row[3]),
                "attendance_sessions": [],
                "work_sessions": [],
            }
            ordered_ids.append(member_id)
        start_at = _ensure_jst(row[4])
        end_at = _ensure_jst(row[5]) if row[5] is not None else None
        grouped[member_id]["attendance_sessions"].append((start_at, end_at))

    for row in work_rows:
        member_id = int(row[1])
        if member_id not in grouped:
            continue
        start_at = _ensure_jst(row[2])
        end_at = _ensure_jst(row[3]) if row[3] is not None else None
        grouped[member_id]["work_sessions"].append((start_at, end_at))

    by_grade: dict[str, list[DayMemberRow]] = {grade: [] for grade in grades}
    count = 0
    present_count = 0

    for member_id in ordered_ids:
        item = grouped[member_id]
        member_row = aggregate_member_day(
            member_id=member_id,
            name=item["name"],
            grade=item["grade"],
            attendance_sessions=item["attendance_sessions"],
            work_sessions=item["work_sessions"],
            day_start=day_start,
            day_end=day_end,
            now=now,
        )
        if member_row is None:
            continue
        grade = member_row["grade"]
        if grade not in by_grade:
            # 在学生がいない学年の当日セッションはボード対象外
            continue
        by_grade[grade].append(member_row)
        count += 1
        if member_row["present"]:
            present_count += 1

    for members in by_grade.values():
        members.sort(key=_arrival_sort_key)

    return {
        "revision": _build_revision(rows, work_rows, now),
        "grades": grades,
        "by_grade": by_grade,
        "count": count,
        "present_count": present_count,
        "day": day_start.date().isoformat(),
    }
