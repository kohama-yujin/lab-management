"""HTTP 層（FastAPI ルータ）。いわゆる controller 相当。"""

from server.routes.api import api_router
from server.routes.auth import auth_router
from server.routes.client import client_router

__all__ = ["api_router", "auth_router", "client_router"]
