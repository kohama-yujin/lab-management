from fastapi import FastAPI

import server.config  # noqa: F401 — logging setup
from server.routes import api_router, client_router
from server.routes.api import ApiError, api_error_handler


def create_app() -> FastAPI:
    application = FastAPI(title="lab-management")
    application.add_exception_handler(ApiError, api_error_handler)
    application.include_router(api_router)
    application.include_router(client_router)
    return application
