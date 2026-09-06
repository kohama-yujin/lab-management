#!/usr/bin/env python3
"""
Lab Tools の VSIX を Slack DM で全メンバーへ配布する CLI。

scripts/release-lab-tools.ps1 から呼ばれる想定。単体でも使える。
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXT_DIR = ROOT / "vscode-extension" / "lab-tools"
DEFAULT_CHANGELOG = EXT_DIR / "CHANGELOG.md"
DEFAULT_PACKAGE_JSON = EXT_DIR / "package.json"

logger = logging.getLogger(__name__)


def _ensure_root_on_path() -> None:
    """リポジトリルートを sys.path に入れる。"""
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))


def _configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(levelname)s: %(message)s")


def read_package_version(package_json: Path) -> str:
    """package.json の version を読む。"""
    data = json.loads(package_json.read_text(encoding="utf-8"))
    version = str(data.get("version") or "").strip()
    if not version:
        raise ValueError(f"version が空です: {package_json}")
    return version


def extract_changelog_section(changelog_path: Path, version: str) -> str:
    """
    CHANGELOG.md から指定バージョンの節本文を抜く。
    見出し行（## [x.y.z]）は含めない。無ければ空文字。
    Slack 向けに ### Added 等は日本語ラベルへ変換する。
    """
    if not changelog_path.is_file():
        return ""

    text = changelog_path.read_text(encoding="utf-8")
    # ## [1.1.0] または ## [1.1.0] - 2026-09-06
    pattern = re.compile(
        rf"^## \[{re.escape(version)}\][^\n]*\n(.*?)(?=^## |\Z)",
        re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(text)
    if not match:
        return ""
    return format_changelog_for_slack(match.group(1))


# Keep a Changelog の ### 見出し → Slack 用の短い日本語
_CHANGELOG_SECTION_LABELS = {
    "added": "追加",
    "changed": "変更",
    "deprecated": "非推奨",
    "removed": "削除",
    "fixed": "修正",
    "security": "セキュリティ",
}


def format_changelog_for_slack(body: str) -> str:
    """
    CHANGELOG 節本文を Slack DM 向けに整形する。
    ### Changed などの英語見出しは日本語にし、空行の連続は詰める。
    """
    lines_out: list[str] = []
    for raw in (body or "").splitlines():
        stripped = raw.strip()
        if not stripped:
            if lines_out and lines_out[-1] != "":
                lines_out.append("")
            continue

        heading = re.match(r"^###\s+(.+)$", stripped)
        if heading:
            key = heading.group(1).strip().lower()
            label = _CHANGELOG_SECTION_LABELS.get(key)
            if label is None:
                # 未知の見出しはそのまま短い強調に
                label = heading.group(1).strip()
            if lines_out and lines_out[-1] != "":
                lines_out.append("")
            lines_out.append(f"*{label}*")
            continue

        lines_out.append(stripped)

    # 末尾の空行を除去
    while lines_out and lines_out[-1] == "":
        lines_out.pop()
    return "\n".join(lines_out)


def resolve_vsix_path(explicit: Path | None, version: str, ext_dir: Path) -> Path:
    """VSIX パスを解決する。"""
    if explicit is not None:
        path = explicit if explicit.is_absolute() else (ROOT / explicit)
        return path.resolve()
    candidate = ext_dir / f"lab-tools-{version}.vsix"
    return candidate.resolve()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Lab Tools VSIX を Slack DM で全メンバーへ配布する",
    )
    parser.add_argument(
        "--vsix",
        type=Path,
        default=None,
        help="配布する .vsix のパス（省略時は lab-tools-{version}.vsix）",
    )
    parser.add_argument(
        "--version",
        default=None,
        help="版番号（省略時は package.json）",
    )
    parser.add_argument(
        "--changelog",
        type=Path,
        default=DEFAULT_CHANGELOG,
        help="CHANGELOG.md のパス",
    )
    parser.add_argument(
        "--package-json",
        type=Path,
        default=DEFAULT_PACKAGE_JSON,
        help="package.json のパス",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="送信せず送信先だけ表示する",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="デバッグログを出す",
    )
    args = parser.parse_args(argv)
    _configure_logging(args.verbose)
    _ensure_root_on_path()

    # .env / DB / Slack は server 経由
    from server.slack_notify import notify_lab_tools_release
    from server.stores.member import fetch_all_slack_user_ids

    package_json = (
        args.package_json if args.package_json.is_absolute() else ROOT / args.package_json
    )
    version = (args.version or "").strip() or read_package_version(package_json.resolve())
    vsix_path = resolve_vsix_path(args.vsix, version, EXT_DIR)
    changelog_path = (
        args.changelog if args.changelog.is_absolute() else ROOT / args.changelog
    )
    changelog_text = extract_changelog_section(changelog_path.resolve(), version)

    if not vsix_path.is_file():
        logger.error("VSIX が見つかりません: %s", vsix_path)
        return 1

    slack_ids = fetch_all_slack_user_ids()
    if not slack_ids:
        logger.error("slack_user_id 付きメンバーがいません")
        return 1

    logger.info(
        "配布準備: version=%s vsix=%s recipients=%d changelog_chars=%d",
        version,
        vsix_path,
        len(slack_ids),
        len(changelog_text),
    )

    result = notify_lab_tools_release(
        vsix_path=vsix_path,
        version=version,
        changelog_text=changelog_text,
        slack_user_ids=slack_ids,
        dry_run=args.dry_run,
    )
    logger.info(
        "完了: ok=%s failed=%s skipped=%s",
        result.get("ok"),
        result.get("failed"),
        result.get("skipped"),
    )
    if result.get("failed", 0) > 0 and result.get("ok", 0) == 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
