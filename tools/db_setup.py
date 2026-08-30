#!/usr/bin/env python3
"""
PostgreSQL の作成・スキーマ適用・初期データ投入を行う CLI。

psql が PATH に無くても psycopg で SQL ファイルを実行できる。
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
DB_DIR = ROOT / "db"
SCHEMA_FILE = DB_DIR / "schema.sql"
SEED_FILE = DB_DIR / "seed.sql"

logger = logging.getLogger(__name__)


def _configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(levelname)s: %(message)s")


def _import_config():
    """server.config を読み込み .env を適用する。"""
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from server.config import load_database_url

    return load_database_url


def _split_conninfo(database_url: str) -> tuple[dict[str, str], str]:
    """接続 URL を conninfo 辞書とデータベース名に分解する。"""
    params = psycopg.conninfo.conninfo_to_dict(database_url)
    dbname = params.get("dbname")
    if not dbname:
        raise ValueError("DATABASE_URL にデータベース名が含まれていません")
    return params, str(dbname)


def _admin_conninfo(params: dict[str, str]) -> dict[str, str]:
    """CREATE DATABASE 用に postgres DB へ接続する conninfo を作る。"""
    admin = dict(params)
    admin["dbname"] = "postgres"
    return admin


def _database_exists(admin_params: dict[str, str], dbname: str) -> bool:
    with psycopg.connect(**admin_params) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM pg_database WHERE datname = %s",
                (dbname,),
            )
            return cur.fetchone() is not None


def ensure_database(database_url: str) -> None:
    """DATABASE_URL のデータベースが無ければ作成する。"""
    params, dbname = _split_conninfo(database_url)
    admin_params = _admin_conninfo(params)

    if _database_exists(admin_params, dbname):
        logger.info("データベース '%s' は既に存在します", dbname)
        return

    logger.info("データベース '%s' を作成します", dbname)
    with psycopg.connect(**admin_params, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                sql.SQL("CREATE DATABASE {}").format(sql.Identifier(dbname))
            )


def _table_exists(conn: psycopg.Connection, table_name: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass(%s)", (f"public.{table_name}",))
        row = cur.fetchone()
        return row is not None and row[0] is not None


def _split_sql_statements(text: str) -> list[str]:
    """SQL ファイルをセミコロン区切りの文に分割する（-- 行コメントは除去）。"""
    lines: list[str] = []
    for line in text.splitlines():
        if line.strip().startswith("--"):
            continue
        lines.append(line)
    body = "\n".join(lines)
    return [part.strip() for part in body.split(";") if part.strip()]


def _execute_sql_file(conn: psycopg.Connection, path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(f"SQL ファイルが見つかりません: {path}")
    text = path.read_text(encoding="utf-8")
    statements = _split_sql_statements(text)
    with conn.cursor() as cur:
        for statement in statements:
            cur.execute(statement)


def apply_schema(conn: psycopg.Connection, *, force: bool = False) -> None:
    """schema.sql を適用する。force=False のとき members テーブルがあればスキップ。"""
    if not force and _table_exists(conn, "members"):
        logger.info("スキーマは既に適用済みのため schema.sql をスキップします")
        return
    logger.info("schema.sql を適用します: %s", SCHEMA_FILE)
    _execute_sql_file(conn, SCHEMA_FILE)


def apply_seed(conn: psycopg.Connection) -> None:
    """seed.sql を適用する（ON CONFLICT により再実行可能）。"""
    logger.info("seed.sql を適用します: %s", SEED_FILE)
    _execute_sql_file(conn, SEED_FILE)


def reset_schema(conn: psycopg.Connection) -> None:
    """public スキーマを削除して作り直す。"""
    logger.warning("public スキーマを削除して再作成します（全データ消去）")
    with conn.cursor() as cur:
        cur.execute("DROP SCHEMA public CASCADE")
        cur.execute("CREATE SCHEMA public")
        cur.execute("GRANT ALL ON SCHEMA public TO PUBLIC")
        cur.execute("GRANT ALL ON SCHEMA public TO CURRENT_USER")


def fetch_status(conn: psycopg.Connection) -> dict[str, int | str]:
    """接続先 DB の概要を返す。"""
    with conn.cursor() as cur:
        cur.execute("SELECT current_database()")
        dbname = str(cur.fetchone()[0])

        counts: dict[str, int | str] = {"database": dbname}
        for table in (
            "roles",
            "grades",
            "members",
            "member_grade_changes",
            "member_role_changes",
            "attendance_sessions",
        ):
            if not _table_exists(conn, table):
                counts[table] = "（テーブルなし）"
                continue
            cur.execute(sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(table)))
            counts[table] = int(cur.fetchone()[0])
        return counts


def _require_database_url() -> str:
    load_database_url = _import_config()
    database_url = load_database_url()
    if not database_url:
        raise SystemExit(
            "DATABASE_URL が未設定です。\n"
            "  1) Copy-Item .env.example .env を実行して .env を編集する\n"
            "  2) または環境変数 DATABASE_URL を設定する\n"
            "詳細: docs/postgresql-setup.md"
        )
    return database_url


def cmd_init(args: argparse.Namespace) -> int:
    database_url = _require_database_url()
    ensure_database(database_url)
    params, _ = _split_conninfo(database_url)

    with psycopg.connect(**params) as conn:
        apply_schema(conn, force=False)
        apply_seed(conn)
        conn.commit()
        status = fetch_status(conn)

    logger.info("初期化が完了しました")
    _print_status(status)
    return 0


def cmd_reset(args: argparse.Namespace) -> int:
    database_url = _require_database_url()
    params, dbname = _split_conninfo(database_url)

    if not args.yes:
        print(
            f"警告: データベース '{dbname}' の public スキーマ内の全データを削除します。",
            file=sys.stderr,
        )
        answer = input("続行するには yes と入力してください: ").strip().lower()
        if answer != "yes":
            print("中止しました", file=sys.stderr)
            return 1

    with psycopg.connect(**params) as conn:
        reset_schema(conn)
        apply_schema(conn, force=True)
        apply_seed(conn)
        conn.commit()
        status = fetch_status(conn)

    logger.info("リセットが完了しました")
    _print_status(status)
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    database_url = _require_database_url()
    params, _ = _split_conninfo(database_url)

    with psycopg.connect(**params) as conn:
        status = fetch_status(conn)

    _print_status(status)
    return 0


def _print_status(status: dict[str, int | str]) -> None:
    print(f"database: {status['database']}")
    for table in (
        "roles",
        "grades",
        "members",
        "member_grade_changes",
        "member_role_changes",
        "attendance_sessions",
    ):
        print(f"  {table}: {status[table]}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="lab-management 用 PostgreSQL セットアップ CLI"
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="詳細ログを出す")
    sub = parser.add_subparsers(dest="command", required=True)

    init_parser = sub.add_parser("init", help="DB 作成・スキーマ・初期データを適用")
    init_parser.set_defaults(func=cmd_init)

    reset_parser = sub.add_parser(
        "reset",
        help="public スキーマを削除して schema/seed を再適用（全データ消去）",
    )
    reset_parser.add_argument(
        "-y",
        "--yes",
        action="store_true",
        help="確認プロンプトを省略する",
    )
    reset_parser.set_defaults(func=cmd_reset)

    status_parser = sub.add_parser("status", help="接続確認とテーブル件数を表示")
    status_parser.set_defaults(func=cmd_status)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    _configure_logging(args.verbose)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
