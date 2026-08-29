from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, RedirectResponse

CLIENT_DIR = Path(__file__).resolve().parents[2] / "client"

client_router = APIRouter()


def _client_file(relative_path: str) -> FileResponse:
    path = (CLIENT_DIR / relative_path).resolve()
    if not path.is_file() or CLIENT_DIR.resolve() not in path.parents:
        raise HTTPException(status_code=404)
    return FileResponse(path)


@client_router.get("/")
def client_page() -> FileResponse:
    return _client_file("pages/index.html")


@client_router.get("/history")
@client_router.get("/history/")
def history_page() -> FileResponse:
    return _client_file("pages/history.html")


@client_router.get("/members")
@client_router.get("/members/")
def members_page() -> FileResponse:
    return _client_file("pages/members.html")


@client_router.get("/client")
@client_router.get("/client/")
def client_legacy_redirect() -> RedirectResponse:
    return RedirectResponse("/", status_code=302)


@client_router.get("/client/{filename:path}")
def client_assets(filename: str) -> FileResponse:
    return _client_file(filename)
