"""パスワードのハッシュ化と検証（標準ライブラリのみ）。"""

from __future__ import annotations

import hashlib
import hmac
import secrets

_ALGORITHM = "pbkdf2_sha256"
_ITERATIONS = 600_000


def hash_password(password: str) -> str:
    """
    パスワードを pbkdf2_sha256 でハッシュ化する。
    形式: pbkdf2_sha256$<iterations>$<salt_hex>$<digest_hex>
    """
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        _ITERATIONS,
    )
    return f"{_ALGORITHM}${_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """保存済みハッシュと平文パスワードを照合する。"""
    try:
        algorithm, iterations_text, salt, digest_hex = stored.split("$", 3)
        if algorithm != _ALGORITHM:
            return False
        iterations = int(iterations_text)
        expected = bytes.fromhex(digest_hex)
    except (TypeError, ValueError):
        return False

    actual = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        iterations,
    )
    return hmac.compare_digest(actual, expected)
