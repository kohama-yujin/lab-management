"""当日（JST）の在室ボード用ステータス集計。"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, TypedDict
from zoneinfo import ZoneInfo

from server.db import StoreError, connect
from server.stores.grade import get_grade_order

logger = logging.getLogger(__name__)

JST = ZoneInfo("Asia/Tokyo")


class DaySessionClip(TypedDict):
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
    session_count: int
    sessions: list[DaySessionClip]


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


def aggregate_member_day(
    *,
    member_id: int,
    name: str,
    grade: str,
    sessions: list[tuple[datetime, datetime | None]],
    day_start: datetime,
    day_end: datetime,
    now: datetime,
) -> DayMemberRow | None:
    """
    1メンバー分の当日表示を集計する。
    sessions: (start_at, end_at)。当日と重ならなければ None。
    """
    clips: list[DaySessionClip] = []
    raw_starts: list[datetime] = []
    raw_ends: list[datetime] = []
    present = False

    for start_at, end_at in sessions:
        start_at = _ensure_jst(start_at)
        end_at = _ensure_jst(end_at) if end_at is not None else None
        open_session = end_at is None
        if open_session:
            present = True
        effective_end = end_at if end_at is not None else now
        clip_start = max(start_at, day_start)
        clip_end = min(effective_end, day_end)
        if clip_end <= clip_start:
            continue

        end_at_is_end_of_day = (not open_session) and end_at is not None and end_at >= day_end
        starts_from_previous_day = start_at < day_start
        # 表示上の終了: 開いていれば now、翌日またぎなら day_end
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

    if not clips:
        return None

    first_start = min(raw_starts)
    arrived_from_previous_day = first_start < day_start
    # 前日開始なら表示上の到着は当日 0:00
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

    total_seconds = sum(clip["duration_seconds"] for clip in clips)

    return {
        "member_id": member_id,
        "name": name,
        "grade": grade,
        "present": present,
        "arrived_at": _to_iso(arrived_at),
        "left_at": _to_iso(left_at) if left_at is not None else None,
        "left_at_is_end_of_day": left_at_is_end_of_day,
        "arrived_from_previous_day": arrived_from_previous_day,
        "left_into_next_day": left_at_is_end_of_day,
        "total_present_seconds": max(0, total_seconds),
        "session_count": len(clips),
        "sessions": clips,
    }


def _build_revision(session_rows: list[tuple[Any, ...]], now: datetime) -> int:
    """
    セッション変化と「分」の進行を検知する revision。
    minute_bucket は必ず1回だけ混ぜる（在室中が偶数人だと XOR が打ち消し合うため）。
    """
    minute_bucket = int(now.timestamp()) // 60
    if not session_rows:
        return minute_bucket & 0x7FFFFFFF

    revision = len(session_rows) * 1_000_000
    for row in session_rows:
        session_id = int(row[0])
        end_at = row[6]
        revision ^= session_id * 1_000_003
        if end_at is not None:
            revision ^= int(end_at.timestamp())
        else:
            revision ^= 7
    revision ^= minute_bucket
    return revision & 0x7FFFFFFF


def get_today_status() -> dict[str, Any]:
    """
    JST 本日の在室ボード用ペイロードを返す。
    public_url はルート側で付与する。
    """
    grades = get_grade_order()
    now, day_start, day_end = _day_bounds()

    try:
        with connect() as conn:
            with conn.cursor() as cur:
                # 当日 [day_start, day_end) と重なるセッション
                cur.execute(
                    """
                    SELECT
                        s.id,
                        m.id AS member_id,
                        m.name,
                        g.code AS grade,
                        g.sort_order,
                        s.start_at,
                        s.end_at
                    FROM attendance_sessions s
                    JOIN members m ON m.id = s.member_id
                    JOIN grades g ON g.id = m.grade_id
                    WHERE s.start_at < %s
                      AND (s.end_at IS NULL OR s.end_at > %s)
                    ORDER BY g.sort_order ASC, m.name ASC, s.start_at ASC
                    """,
                    (day_end, day_start),
                )
                rows = cur.fetchall()
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
                "sessions": [],
            }
            ordered_ids.append(member_id)
        start_at = _ensure_jst(row[5])
        end_at = _ensure_jst(row[6]) if row[6] is not None else None
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
            now=now,
        )
        if member_row is None:
            continue
        grade = member_row["grade"]
        if grade not in by_grade:
            by_grade[grade] = []
        by_grade[grade].append(member_row)
        count += 1

    return {
        "revision": _build_revision(rows, now),
        "grades": grades,
        "by_grade": by_grade,
        "count": count,
        "day": day_start.date().isoformat(),
    }
