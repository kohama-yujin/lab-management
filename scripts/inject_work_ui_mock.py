#!/usr/bin/env python3
"""
作業時間 UI デバッグ用モック投入（一時スクリプト・削除予定）。

username が dbg_ で始まるメンバーだけ削除・再投入する。
それ以外の members / セッションは触らない。

使い方:
  python scripts/inject_work_ui_mock.py -y
"""

from __future__ import annotations

import argparse
import logging
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg

ROOT = Path(__file__).resolve().parents[1]
JST = ZoneInfo("Asia/Tokyo")
MOCK_PASSWORD = "mock"
DBG_USERNAME_PREFIX = "dbg_"

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MockMemberSpec:
    username: str
    name: str
    grade: str


# 名前 = デバッグ対象の状態
MOCK_MEMBERS: tuple[MockMemberSpec, ...] = (
    # --- 既存（基本状態） ---
    MockMemberSpec("dbg_present_working", "在室・作業中・青ドット", "M1"),
    MockMemberSpec("dbg_present_idle_zero", "在室・非作業・作業0", "M1"),
    MockMemberSpec("dbg_present_idle_hist", "在室・非作業・累計45分", "M1"),
    MockMemberSpec("dbg_away_work_hist", "不在・作業累計2h", "M1"),
    MockMemberSpec("dbg_present_work_zero", "在室・作業中・累計0", "M1"),
    MockMemberSpec("dbg_away_zero", "不在・在室作業とも0", "M1"),
    MockMemberSpec("dbg_chart_multi", "在室・作業3区間", "M1"),
    MockMemberSpec("dbg_b4_present", "B4・在室・非作業", "B4"),
    MockMemberSpec("dbg_yesterday", "昨日記録・履歴用", "M1"),
    # --- 追加（端・日跨ぎ・エッジ） ---
    MockMemberSpec("dbg_edge_arrive_0000", "到着0:00・前日から在室", "M1"),
    MockMemberSpec("dbg_edge_leave_2400", "帰宅24:00・翌日まで在室", "M1"),
    MockMemberSpec("dbg_edge_near_0000_short", "到着帰宅0:00付近・短時間", "M1"),
    MockMemberSpec("dbg_edge_full_span", "到着0:00・帰宅24:00・帯フル", "M1"),
    MockMemberSpec("dbg_edge_combined_label", "到着帰宅近接・まとめラベル", "M1"),
    MockMemberSpec("dbg_cross_present_open", "在室日跨ぎ・継続在室中", "M1"),
    MockMemberSpec("dbg_cross_present_done", "在室日跨ぎ・今朝退室", "M1"),
    MockMemberSpec("dbg_cross_work_open", "作業日跨ぎ・継続作業中", "M1"),
    MockMemberSpec("dbg_cross_work_done", "作業日跨ぎ・日跨ぎ終了", "M1"),
    MockMemberSpec("dbg_cross_both_open", "在室作業とも日跨ぎ・継続", "M1"),
    MockMemberSpec("dbg_cross_work_only_clip", "作業のみ日跨ぎクリップ", "M1"),
    MockMemberSpec("dbg_two_present_sess", "在室2本・途中退室再入室", "M1"),
    MockMemberSpec("dbg_overnight_then_away", "夜跨ぎ在室・既に退室", "M1"),
    MockMemberSpec("dbg_yesterday_cross", "昨日・在室作業とも日跨ぎ", "M1"),
    MockMemberSpec("dbg_m2_present", "M2・在室・作業中", "M2"),
)


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(level=logging.DEBUG if verbose else logging.INFO, format="%(levelname)s: %(message)s")


def _require_database_url() -> str:
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from server.config import load_database_url

    url = load_database_url()
    if not url:
        raise SystemExit(
            "DATABASE_URL が未設定です。.env を確認してください。\n"
            "詳細: docs/postgresql-setup.md"
        )
    return url


def _jst_day_start(now: datetime) -> datetime:
    local = now.astimezone(JST)
    return datetime(local.year, local.month, local.day, tzinfo=JST)


def _clear_dbg_mock_only(conn: psycopg.Connection) -> None:
    """dbg_ メンバーとそのセッションだけ削除する。"""
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM work_sessions
            WHERE member_id IN (SELECT id FROM members WHERE username LIKE %s)
            """,
            (f"{DBG_USERNAME_PREFIX}%",),
        )
        cur.execute(
            """
            DELETE FROM attendance_sessions
            WHERE member_id IN (SELECT id FROM members WHERE username LIKE %s)
            """,
            (f"{DBG_USERNAME_PREFIX}%",),
        )
        cur.execute(
            """
            DELETE FROM member_graduation_changes
            WHERE member_id IN (SELECT id FROM members WHERE username LIKE %s)
            """,
            (f"{DBG_USERNAME_PREFIX}%",),
        )
        cur.execute(
            """
            DELETE FROM member_role_changes
            WHERE member_id IN (SELECT id FROM members WHERE username LIKE %s)
            """,
            (f"{DBG_USERNAME_PREFIX}%",),
        )
        cur.execute(
            """
            DELETE FROM member_grade_changes
            WHERE member_id IN (SELECT id FROM members WHERE username LIKE %s)
            """,
            (f"{DBG_USERNAME_PREFIX}%",),
        )
        cur.execute(
            "DELETE FROM members WHERE username LIKE %s",
            (f"{DBG_USERNAME_PREFIX}%",),
        )


def _insert_members(conn: psycopg.Connection, password_hash: str) -> dict[str, int]:
    member_ids: dict[str, int] = {}
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM roles WHERE code = 'member'")
        role_id = int(cur.fetchone()[0])

        for spec in MOCK_MEMBERS:
            cur.execute("SELECT id FROM grades WHERE code = %s", (spec.grade,))
            grade_row = cur.fetchone()
            if not grade_row:
                raise SystemExit(f"学年 '{spec.grade}' が見つかりません。先に db_setup init を実行してください。")
            grade_id = int(grade_row[0])

            cur.execute(
                """
                INSERT INTO members (
                    username, password_hash, name, role_id, grade_id, graduation_year
                )
                VALUES (%s, %s, %s, %s, %s, NULL)
                RETURNING id
                """,
                (spec.username, password_hash, spec.name, role_id, grade_id),
            )
            member_id = int(cur.fetchone()[0])
            member_ids[spec.username] = member_id

            cur.execute(
                """
                INSERT INTO member_grade_changes (member_id, grade_id_from, grade_id_to)
                VALUES (%s, NULL, %s)
                """,
                (member_id, grade_id),
            )
            cur.execute(
                """
                INSERT INTO member_role_changes (member_id, role_id_from, role_id_to)
                VALUES (%s, NULL, %s)
                """,
                (member_id, role_id),
            )
            cur.execute(
                """
                INSERT INTO member_graduation_changes (
                    member_id, graduation_year_from, graduation_year_to
                )
                VALUES (%s, NULL, NULL)
                """,
                (member_id,),
            )
    return member_ids


def _insert_sessions(conn: psycopg.Connection, member_ids: dict[str, int]) -> None:
    now = datetime.now(JST)
    day_start = _jst_day_start(now)
    yesterday_start = day_start - timedelta(days=1)
    elapsed_min = max(1, int((now - day_start).total_seconds() // 60))
    latest_past = now - timedelta(minutes=1)

    def mins_ago(minutes: int) -> datetime:
        return now - timedelta(minutes=min(minutes, elapsed_min - 1))

    def past(dt: datetime) -> datetime:
        """未来の時刻は 1 分前にクリップする。"""
        return min(dt, latest_past)

    def at_today(hour: int, minute: int = 0) -> datetime:
        return past(day_start + timedelta(hours=hour, minutes=minute))

    def at_yesterday(hour: int, minute: int = 0) -> datetime:
        return yesterday_start + timedelta(hours=hour, minutes=minute)

    def after_midnight_today(minutes: int) -> datetime:
        """当日 0:00 からの経過分（未来ならクリップ）。"""
        return past(day_start + timedelta(minutes=minutes))

    m = member_ids

    with conn.cursor() as cur:
        # ===== 既存シナリオ =====
        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, NULL)",
            (m["dbg_present_working"], mins_ago(200)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, %s)",
            (m["dbg_present_working"], mins_ago(120), mins_ago(90)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, NULL)",
            (m["dbg_present_working"], mins_ago(75)),
        )

        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, NULL)",
            (m["dbg_present_idle_zero"], mins_ago(150)),
        )

        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, NULL)",
            (m["dbg_present_idle_hist"], mins_ago(130)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, %s)",
            (m["dbg_present_idle_hist"], mins_ago(100), mins_ago(55)),
        )

        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, %s)",
            (m["dbg_away_work_hist"], mins_ago(elapsed_min - 3), mins_ago(40)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, %s)",
            (m["dbg_away_work_hist"], mins_ago(180), mins_ago(60)),
        )

        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, NULL)",
            (m["dbg_present_work_zero"], mins_ago(180)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, NULL)",
            (m["dbg_present_work_zero"], now - timedelta(minutes=2)),
        )

        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, %s)",
            (m["dbg_away_zero"], mins_ago(50), mins_ago(35)),
        )

        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, NULL)",
            (m["dbg_chart_multi"], mins_ago(elapsed_min - 2)),
        )
        for start_m, end_m in ((90, 75), (60, 45), (30, 15)):
            cur.execute(
                "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, %s)",
                (m["dbg_chart_multi"], mins_ago(start_m), mins_ago(end_m)),
            )

        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, NULL)",
            (m["dbg_b4_present"], mins_ago(100)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, %s)",
            (m["dbg_b4_present"], mins_ago(80), mins_ago(50)),
        )

        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, %s)",
            (m["dbg_yesterday"], at_yesterday(10, 0), at_yesterday(17, 30)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, %s)",
            (m["dbg_yesterday"], at_yesterday(11, 0), at_yesterday(13, 0)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, %s)",
            (m["dbg_yesterday"], at_yesterday(14, 30), at_yesterday(16, 0)),
        )

        # ===== 到着・帰宅が 0:00 付近 =====
        # 前日 23:40 入室 → 継続在室（到着表示 0:00）
        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, NULL)",
            (m["dbg_edge_arrive_0000"], at_yesterday(23, 40)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, NULL)",
            (m["dbg_edge_arrive_0000"], at_today(0, 15)),
        )

        # 前日 20:00 入室 → 当日 0:30 退室（帰宅表示 24:00）
        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, %s)",
            (m["dbg_edge_leave_2400"], at_yesterday(20, 0), after_midnight_today(30)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, %s)",
            (m["dbg_edge_leave_2400"], at_yesterday(21, 0), after_midnight_today(15)),
        )

        # 当日 0:05 → 0:22 退室（両端が左寄り）
        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, %s)",
            (m["dbg_edge_near_0000_short"], at_today(0, 5), at_today(0, 22)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, %s)",
            (m["dbg_edge_near_0000_short"], at_today(0, 8), at_today(0, 18)),
        )

        # 前日 22:00 入室 → 当日 1:00 退室（帯がほぼ全日）
        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, %s)",
            (m["dbg_edge_full_span"], at_yesterday(22, 0), after_midnight_today(60)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, %s)",
            (m["dbg_edge_full_span"], at_yesterday(23, 0), after_midnight_today(45)),
        )

        # 0:10 → 0:18（まとめラベル判定用・間隔が狭い）
        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, %s)",
            (m["dbg_edge_combined_label"], at_today(0, 10), at_today(0, 18)),
        )

        # ===== 在室の日跨ぎ =====
        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, NULL)",
            (m["dbg_cross_present_open"], at_yesterday(21, 30)),
        )

        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, %s)",
            (m["dbg_cross_present_done"], at_yesterday(19, 0), at_today(7, 45)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, %s)",
            (m["dbg_cross_present_done"], at_yesterday(20, 0), at_today(6, 30)),
        )

        # ===== 作業の日跨ぎ =====
        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, NULL)",
            (m["dbg_cross_work_open"], mins_ago(120)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, NULL)",
            (m["dbg_cross_work_open"], at_yesterday(23, 10)),
        )

        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, NULL)",
            (m["dbg_cross_work_done"], mins_ago(150)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, %s)",
            (m["dbg_cross_work_done"], at_yesterday(22, 45), after_midnight_today(75)),
        )

        # 在室・作業とも継続（前日から）
        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, NULL)",
            (m["dbg_cross_both_open"], at_yesterday(20, 45)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, NULL)",
            (m["dbg_cross_both_open"], at_yesterday(22, 0)),
        )

        # 在室は当日のみ・作業だけ前日からクリップ
        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, NULL)",
            (m["dbg_cross_work_only_clip"], mins_ago(90)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, %s)",
            (m["dbg_cross_work_only_clip"], at_yesterday(23, 30), after_midnight_today(120)),
        )

        # ===== その他 =====
        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, %s)",
            (m["dbg_two_present_sess"], mins_ago(300), mins_ago(180)),
        )
        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, NULL)",
            (m["dbg_two_present_sess"], mins_ago(120)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, %s)",
            (m["dbg_two_present_sess"], mins_ago(270), mins_ago(200)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, NULL)",
            (m["dbg_two_present_sess"], mins_ago(90)),
        )

        # 前日 23:15 → 当日 0:45 退室済み
        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, %s)",
            (m["dbg_overnight_then_away"], at_yesterday(23, 15), after_midnight_today(45)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, %s)",
            (m["dbg_overnight_then_away"], at_yesterday(23, 45), after_midnight_today(30)),
        )

        # 履歴ページ用: 昨日に日跨ぎセッション
        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, %s)",
            (m["dbg_yesterday_cross"], at_yesterday(22, 30), day_start + timedelta(hours=2)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, %s)",
            (m["dbg_yesterday_cross"], at_yesterday(23, 0), day_start + timedelta(hours=1, minutes=30)),
        )

        # M2 学年ボード
        cur.execute(
            "INSERT INTO attendance_sessions (member_id, start_at, end_at) VALUES (%s, %s, NULL)",
            (m["dbg_m2_present"], mins_ago(160)),
        )
        cur.execute(
            "INSERT INTO work_sessions (member_id, location, start_at, end_at) VALUES (%s, 'lab', %s, NULL)",
            (m["dbg_m2_present"], mins_ago(130)),
        )


def _print_summary(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM members")
        members = int(cur.fetchone()[0])
        cur.execute("SELECT COUNT(*) FROM members WHERE username LIKE %s", (f"{DBG_USERNAME_PREFIX}%",))
        dbg_members = int(cur.fetchone()[0])
        cur.execute("SELECT COUNT(*) FROM attendance_sessions")
        attendance = int(cur.fetchone()[0])
        cur.execute("SELECT COUNT(*) FROM work_sessions")
        work = int(cur.fetchone()[0])
    print(f"members: {members} (dbg_: {dbg_members})")
    print(f"attendance_sessions: {attendance}")
    print(f"work_sessions: {work}")
    print()
    print("dbg_ メンバー一覧（パスワード mock）:")
    for spec in MOCK_MEMBERS:
        print(f"  {spec.username:28} → {spec.name}")


def inject(*, assume_yes: bool) -> int:
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from server.password_utils import hash_password

    database_url = _require_database_url()
    params = psycopg.conninfo.conninfo_to_dict(database_url)

    if not assume_yes:
        print(
            f"警告: username が '{DBG_USERNAME_PREFIX}' で始まるメンバーとそのセッションだけ"
            "削除して再投入します。それ以外のデータは残します。"
        )
        answer = input("続行するには yes と入力してください: ").strip().lower()
        if answer != "yes":
            print("中止しました", file=sys.stderr)
            return 1

    password_hash = hash_password(MOCK_PASSWORD)

    with psycopg.connect(**params) as conn:
        _clear_dbg_mock_only(conn)
        member_ids = _insert_members(conn, password_hash)
        _insert_sessions(conn, member_ids)
        conn.commit()
        _print_summary(conn)

    logger.info("モック投入が完了しました")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="作業時間 UI デバッグ用モック投入（一時スクリプト）")
    parser.add_argument("-y", "--yes", action="store_true", help="確認を省略する")
    parser.add_argument("-v", "--verbose", action="store_true", help="詳細ログ")
    args = parser.parse_args(argv)
    _configure_logging(args.verbose)
    return inject(assume_yes=args.yes)


if __name__ == "__main__":
    raise SystemExit(main())
