"""メンバー登録・更新時の入力バリデーション。"""

from __future__ import annotations

import re

USERNAME_MIN_LEN = 3
USERNAME_MAX_LEN = 16
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_]+$")

PASSWORD_MIN_LEN = 8
PASSWORD_MAX_LEN = 128

NAME_MAX_LEN = 10


class MemberValidationError(Exception):
    """入力バリデーションエラー。"""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def normalize_username(username: str) -> str:
    """ユーザー名を検証して正規化する。"""
    value = (username or "").strip()
    if not value:
        raise MemberValidationError("ユーザー名は必須です", 400)
    if len(value) < USERNAME_MIN_LEN:
        raise MemberValidationError(
            f"ユーザー名は {USERNAME_MIN_LEN} 文字以上にしてください",
            400,
        )
    if len(value) > USERNAME_MAX_LEN:
        raise MemberValidationError(
            f"ユーザー名は {USERNAME_MAX_LEN} 文字以内にしてください",
            400,
        )
    if not USERNAME_PATTERN.fullmatch(value):
        raise MemberValidationError(
            "ユーザー名は英数字とアンダースコア（_）のみ使用できます",
            400,
        )
    return value


def normalize_name(name: str) -> str:
    """表示名を検証して正規化する。"""
    value = (name or "").strip()
    if not value:
        raise MemberValidationError("名前は必須です", 400)
    if len(value) > NAME_MAX_LEN:
        raise MemberValidationError(
            f"名前は {NAME_MAX_LEN} 文字以内にしてください",
            400,
        )
    return value


def validate_password(password: str, *, required: bool) -> None:
    """パスワードを検証する。required=False のとき空文字は許可。"""
    if not password:
        if required:
            raise MemberValidationError("パスワードは必須です", 400)
        return
    if len(password) < PASSWORD_MIN_LEN:
        raise MemberValidationError(
            f"パスワードは {PASSWORD_MIN_LEN} 文字以上にしてください",
            400,
        )
    if len(password) > PASSWORD_MAX_LEN:
        raise MemberValidationError(
            f"パスワードは {PASSWORD_MAX_LEN} 文字以内にしてください",
            400,
        )
