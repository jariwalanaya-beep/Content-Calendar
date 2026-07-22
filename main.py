"""
Content Hub — a local, single-user replacement for the storage half of Notion.

Run it with:

    uvicorn main:app --reload

then open http://127.0.0.1:8000

There is no authentication: the server binds to loopback only and is meant to be
reachable from this machine alone.
"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from database import init_db
from routers import content, media, weekly

STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create the media folder and database schema before serving traffic."""
    settings.ensure_directories()
    init_db()
    print(f"  Content Hub ready")
    print(f"  media folder : {settings.MEDIA_ROOT}")
    print(f"  database     : {settings.DB_PATH}")
    print(f"  open         : http://{settings.HOST}:{settings.PORT}")
    yield


app = FastAPI(
    title="Content Hub",
    description="Local content calendar and video library.",
    version="1.0.0",
    lifespan=lifespan,
)

# All API routes live under /api so they never collide with the static frontend.
app.include_router(weekly.router, prefix="/api")
app.include_router(content.router, prefix="/api")
app.include_router(media.router, prefix="/api")


@app.get("/api/config", tags=["meta"])
def read_config() -> dict:
    """
    Non-secret runtime info, shown in the UI footer.

    Handy for confirming at a glance that the app is writing to the drive you
    think it is.
    """
    media_root = settings.MEDIA_ROOT
    usage = None
    try:
        import shutil
        total, used, free = shutil.disk_usage(media_root)
        usage = {"total_bytes": total, "used_bytes": used, "free_bytes": free}
    except OSError:
        pass
    return {
        "media_root": str(media_root),
        "db_path": str(settings.DB_PATH),
        "max_upload_bytes": settings.MAX_UPLOAD_BYTES,
        "allowed_extensions": sorted(settings.ALLOWED_VIDEO_EXTENSIONS),
        "disk": usage,
    }


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    """Serve the single-page app."""
    return FileResponse(STATIC_DIR / "index.html")


# Mounted last so it cannot shadow any /api route.
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.exception_handler(404)
async def spa_fallback(request, exc):
    """
    Send unknown non-API paths back to the SPA so client-side routes such as
    /#/content/12 survive a page refresh. API 404s stay real 404s.
    """
    if request.url.path.startswith("/api/"):
        return JSONResponse({"detail": getattr(exc, "detail", "Not found")},
                            status_code=404)
    return FileResponse(STATIC_DIR / "index.html", status_code=200)


if __name__ == "__main__":
    # Allows `python main.py` as an alternative to the uvicorn CLI.
    import uvicorn
    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=True)
