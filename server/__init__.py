from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

import server.config  # noqa: F401 — logging setup
from server.config import load_session_secret
from server.db import StoreError
from server.routes import api_router, auth_router, client_router
from server.routes.api import ApiError, api_error_handler, store_error_handler


def create_app() -> FastAPI:
    application = FastAPI(title="lab-management")
    # リクエストヘッダの Cookie をセッションに保存するためのミドルウェア
    application.add_middleware(
        SessionMiddleware,
        secret_key=load_session_secret(),
        same_site="lax",
        https_only=False,
    )
    application.add_exception_handler(ApiError, api_error_handler)
    application.add_exception_handler(StoreError, store_error_handler)
    application.include_router(api_router)
    application.include_router(auth_router)
    application.include_router(client_router)
    return application
