import hmac
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from server.config import load_api_key, load_public_tunnel_url
from server.db import StoreError
from server.stores import attendance as attendance_store
from server.stores.grade import get_grade_order
from server.stores.history import get_history_for_day, list_history_dates
from server.stores.member import create_member, list_active_members, list_graduated_members, update_member
from server.stores.role import get_roles
from server.stores.status import get_today_status

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


def store_error_handler(_request: Request, exc: StoreError) -> JSONResponse:
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


@api_router.get("/health")
def health() -> PlainTextResponse:
    return PlainTextResponse("running")


@api_router.get("/get_grade")
def get_grade() -> dict[str, list[str]]:
    return {"grades": get_grade_order()}


@api_router.get("/get_role")
def get_role() -> dict[str, list[dict[str, str]]]:
    return {"roles": get_roles()}


@api_router.get("/members/list")
def members_list(
    graduated: int = 0,
    offset: int = 0,
    limit: int = 20,
) -> dict[str, Any]:
    """メンバー一覧。graduated=1 で卒業済みをページ取得する。"""
    if graduated:
        members, total = list_graduated_members(offset, limit)
        return {"members": members, "total": total}

    members = list_active_members()
    return {"members": members, "total": len(members)}


@api_router.post("/members")
async def members_create(request: Request) -> dict[str, Any]:
    """メンバーを新規登録する。"""
    try:
        body = await request.json()
    except Exception:
        body = {}

    if not isinstance(body, dict):
        raise ApiError("JSON 本文が不正です", 400)

    member = create_member(
        name=str(body.get("name") or ""),
        grade=str(body.get("grade") or ""),
        role=str(body.get("role") or ""),
        username=str(body.get("username") or ""),
        password=str(body.get("password") or ""),
    )
    return {"ok": True, "member": member}


@api_router.put("/members/{member_id}")
async def members_update(member_id: int, request: Request) -> dict[str, Any]:
    """メンバー情報を更新する。"""
    try:
        body = await request.json()
    except Exception:
        body = {}

    if not isinstance(body, dict):
        raise ApiError("JSON 本文が不正です", 400)

    password = body.get("password")
    graduation_year = body.get("graduation_year")
    if graduation_year is not None and graduation_year != "":
        try:
            graduation_year = int(graduation_year)
        except (TypeError, ValueError):
            raise ApiError("graduation_year が不正です", 400)
    else:
        graduation_year = None

    member = update_member(
        member_id,
        name=str(body.get("name") or ""),
        grade=str(body.get("grade") or ""),
        role=str(body.get("role") or ""),
        username=str(body.get("username") or ""),
        password=str(password) if password else None,
        graduation_year=graduation_year,
    )
    return {"ok": True, "member": member}


@api_router.get("/status")
def status() -> dict[str, Any]:
    """当日（JST）の在室ボード。"""
    payload = get_today_status()
    payload["public_url"] = load_public_tunnel_url()
    return payload


@api_router.get("/history/dates")
def get_dates() -> dict[str, list[str]]:
    """在室があった過去日（JST）を新しい順で返す。空の日は含まない。"""
    return {"dates": list_history_dates()}


@api_router.get("/history/{day}")
def get_history(day: str) -> dict[str, Any]:
    """指定日の在室履歴。当日・空の日は 404。"""
    data = get_history_for_day(day)
    if data is None:
        raise ApiError(
            "指定日の記録がありません",
            404,
        )
    return data


@api_router.post("/start_attendance")
async def start_attendance(body: Annotated[dict[str, Any], Depends(require_api_key)]) -> dict[str, Any]:
    """在室セッションの開始。"""
    username = body.get("username")
    password = body.get("password")

    if not username or not password:
        raise ApiError("username と password は必須です", 400)

    result = attendance_store.start_attendance(str(username), str(password))
    return {
        "ok": result["ok"],
        "ignored": result["ignored"],
        "message": result["message"],
        "public_url": load_public_tunnel_url(),
    }


@api_router.post("/end_attendance")
async def end_attendance(body: Annotated[dict[str, Any], Depends(require_api_key)]) -> dict[str, Any]:
    """在室セッションの終了。日付またぎの在室セッションも閉じる。"""
    username = body.get("username")
    password = body.get("password")

    if not username or not password:
        raise ApiError("username と password は必須です", 400)

    result = attendance_store.end_attendance(str(username), str(password))
    return {
        "ok": result["ok"],
        "ignored": result["ignored"],
        "message": result["message"],
    }
