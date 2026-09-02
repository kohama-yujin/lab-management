"""
Slack OpenID Connect による Web ログイン。
docs/slack-sign-in-with-slack.md を参照。
"""

from __future__ import annotations

import json
import logging
import secrets
import urllib.error
import urllib.parse
import urllib.request

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse

from server.config import (
    load_slack_client_id,
    load_slack_client_secret,
    load_slack_redirect_uri,
)
from server.stores.member import fetch_member_by_id, fetch_member_by_slack_user_id

logger = logging.getLogger(__name__)

auth_router = APIRouter(tags=["auth"])

SLACK_AUTHORIZE_URL = "https://slack.com/openid/connect/authorize"
SLACK_TOKEN_URL = "https://slack.com/api/openid.connect.token"
SLACK_USERINFO_URL = "https://slack.com/api/openid.connect.userInfo"


def _slack_configured() -> bool:
    return bool(load_slack_client_id() and load_slack_client_secret())


def _post_form(url: str, data: dict[str, str]) -> dict:
    """application/x-www-form-urlencoded で POST し JSON を返す。"""
    body = urllib.parse.urlencode(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get_bearer_json(url: str, access_token: str) -> dict:
    """Bearer トークン付き GET で JSON を返す。"""
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {access_token}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


@auth_router.get("/auth/me")
def auth_me(request: Request) -> JSONResponse:
    """現在のログイン状態を返す。"""
    member_id = request.session.get("member_id")
    if not member_id:
        return JSONResponse({"logged_in": False})

    member = fetch_member_by_id(int(member_id))
    if member is None:
        request.session.clear()
        return JSONResponse({"logged_in": False})

    return JSONResponse(
        {
            "logged_in": True,
            "name": member["name"],
            "grade": member["grade"],
        }
    )


@auth_router.get("/auth/slack")
def slack_login(request: Request) -> RedirectResponse:
    """Slack 認可画面へリダイレクトする。"""
    if not _slack_configured():
        return RedirectResponse(url="/?auth_error=slack_not_configured", status_code=302)

    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    request.session["slack_oauth_state"] = state
    request.session["slack_oauth_nonce"] = nonce

    params = {
        "response_type": "code",
        "scope": "openid profile",
        "client_id": load_slack_client_id() or "",
        "redirect_uri": load_slack_redirect_uri(),
        "state": state,
        "nonce": nonce,
    }
    url = f"{SLACK_AUTHORIZE_URL}?{urllib.parse.urlencode(params)}"
    return RedirectResponse(url=url, status_code=302)


@auth_router.get("/auth/slack/callback")
def slack_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Slack 認可コールバック。メンバーを特定してセッションを開始する。"""
    if error:
        logger.warning("Slack OAuth エラー: %s", error)
        return RedirectResponse(url="/?auth_error=slack_denied", status_code=302)

    expected_state = request.session.pop("slack_oauth_state", None)
    request.session.pop("slack_oauth_nonce", None)
    if not code or not state or state != expected_state:
        return RedirectResponse(url="/?auth_error=invalid_state", status_code=302)

    if not _slack_configured():
        return RedirectResponse(url="/?auth_error=slack_not_configured", status_code=302)

    try:
        token_payload = _post_form(
            SLACK_TOKEN_URL,
            {
                "client_id": load_slack_client_id() or "",
                "client_secret": load_slack_client_secret() or "",
                "code": code,
                "redirect_uri": load_slack_redirect_uri(),
                "grant_type": "authorization_code",
            },
        )
    except urllib.error.URLError as exc:
        logger.exception("Slack トークン取得に失敗しました")
        return RedirectResponse(url="/?auth_error=token_failed", status_code=302)

    if token_payload.get("ok") is False:
        logger.warning("Slack トークン応答エラー: %s", token_payload)
        return RedirectResponse(url="/?auth_error=token_failed", status_code=302)

    access_token = token_payload.get("access_token")
    if not access_token:
        return RedirectResponse(url="/?auth_error=token_failed", status_code=302)

    try:
        user_info = _get_bearer_json(SLACK_USERINFO_URL, str(access_token))
    except urllib.error.URLError:
        logger.exception("Slack ユーザー情報取得に失敗しました")
        return RedirectResponse(url="/?auth_error=userinfo_failed", status_code=302)

    if user_info.get("ok") is False:
        logger.warning("Slack ユーザー情報エラー: %s", user_info)
        return RedirectResponse(url="/?auth_error=userinfo_failed", status_code=302)

    slack_user_id = str(user_info.get("sub") or "").strip()
    if not slack_user_id:
        return RedirectResponse(url="/?auth_error=no_user_id", status_code=302)

    member = fetch_member_by_slack_user_id(slack_user_id)
    if member is None:
        logger.info("未登録の Slack ユーザー: %s", slack_user_id)
        return RedirectResponse(url="/?auth_error=member_not_found", status_code=302)

    request.session["member_id"] = member["id"]
    return RedirectResponse(url="/", status_code=302)


@auth_router.post("/auth/logout")
def logout(request: Request) -> JSONResponse:
    """セッションを破棄する。"""
    request.session.clear()
    return JSONResponse({"ok": True})
