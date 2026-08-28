import hmac
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from server.config import load_api_key, load_public_tunnel_url
from server.grade_store import get_grade_order
from server.role_store import get_roles

api_router = APIRouter()


class ApiError(Exception):
    """API エラーを既存の JSON 形式で返す。"""

    def __init__(self, message: str, status_code: int) -> None:
        self.message = message
        self.status_code = status_code


def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"ok": False, "error": True, "message": exc.message},
    )


def _extract_api_key(data: dict[str, Any] | None, x_api_key: str | None, authorization: str | None) -> str | None:
    """JSON 本文・ヘッダから API キーを取り出す。"""
    if data and isinstance(data.get("api_key"), str) and data["api_key"].strip():
        return data["api_key"].strip()

    if x_api_key and x_api_key.strip():
        return x_api_key.strip()

    auth = authorization or ""
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token:
            return token
    return None


async def require_api_key(
    request: Request,
    x_api_key: Annotated[str | None, Header(alias="X-Api-Key")] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """POST 用: 共有 API キーを検証する。"""
    expected = load_api_key()
    if not expected:
        raise ApiError(
            "api_key.json が未設定です（api_key.example.json をコピーして設定）",
            503,
        )

    try:
        data = await request.json()
    except Exception:
        data = None

    provided = _extract_api_key(data if isinstance(data, dict) else None, x_api_key, authorization)
    if (
        not provided
        or len(provided) != len(expected)
        or not hmac.compare_digest(provided, expected)
    ):
        raise ApiError("APIキーが無効です", 401)

    return data if isinstance(data, dict) else {}


def _empty_status_payload() -> dict[str, Any]:
    grades = get_grade_order()
    return {
        "revision": 0,
        "public_url": load_public_tunnel_url(),
        "grades": grades,
        "by_grade": {grade: [] for grade in grades},
        "count": 0,
    }


@api_router.get("/health")
def health() -> PlainTextResponse:
    return PlainTextResponse("running")


@api_router.get("/get_grade")
def get_grade() -> dict[str, list[str]]:
    return {"grades": get_grade_order()}


@api_router.get("/get_role")
def get_role() -> dict[str, list[dict[str, str]]]:
    return {"roles": get_roles()}


@api_router.get("/status")
def status() -> dict[str, Any]:
    # return get_status()
    return _empty_status_payload()


@api_router.get("/history/dates")
def get_dates() -> dict[str, list[str]]:
    # return {"dates": list_history_dates()}
    return {"dates": []}


@api_router.get("/history/{day}")
def get_history(day: str) -> dict[str, Any]:
    # data = get_history(day)
    # if data is None:
    #     raise ApiError(
    #         "指定日の記録がありません（当日は履歴対象外です）",
    #         404,
    #     )
    # return data
    payload = _empty_status_payload()
    payload["day"] = day
    return payload


@api_router.post("/attendance_start")
async def attendance_start(body: Annotated[dict[str, Any], Depends(require_api_key)]) -> dict[str, Any]:
    username = body.get("username")
    password = body.get("password")

    if not username or not password:
        raise ApiError("username と password は必須です", 400)

    # result = start_monitoring(name, grade)
    # if result == "full":
    #     raise ApiError("同時接続数の上限に達しています", 429)
    # return {
    #     "ok": True,
    #     "message": "受け付けました",
    #     "public_url": load_public_tunnel_url(),
    # }
    return {"ok": True,
            "message": "在室登録が完了しました",
            "public_url": load_public_tunnel_url(),
    }


@api_router.post("/attendance_end")
async def attendance_end(body: Annotated[dict[str, Any], Depends(require_api_key)]) -> dict[str, Any]:
    """Wi‑Fi 切断時の不在トリガー。"""
    username = body.get("username")
    password = body.get("password")

    if not username or not password:
        raise ApiError("username と password は必須です", 400)

    # result = stop_monitoring(name, grade)
    # if result == "missing":
    #     return {
    #         "ok": True,
    #         "ignored": True,
    #         "message": "当日の在室記録が見つかりません",
    #     }
    # if result == "already_absent":
    #     return {
    #         "ok": True,
    #         "ignored": True,
    #         "message": "すでに不在です",
    #     }
    # return {
    #     "ok": True,
    #     "message": "不在にしました",
    # }
    return {"ok": True, "message": "不在登録が完了しました"}
