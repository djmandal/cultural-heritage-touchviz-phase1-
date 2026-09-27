import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.api.routes import health, datasets
from app.api.routes import admin_auth, admin_datasets, public_datasets

app = FastAPI(title="HyperHeritage Backend", version="0.1.0")

allowed_origins = [
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in (5173, 5174, 4173)
]
lan_ip = os.getenv("TOUCHVIZ_LAN_IP", "").strip()
if lan_ip:
    allowed_origins.extend(
        f"http://{lan_ip}:{port}" for port in (5173, 5174, 4173)
    )
allowed_origins.extend(
    origin.strip().rstrip("/")
    for origin in os.getenv("TOUCHVIZ_ADMIN_ORIGINS", "").split(",")
    if origin.strip()
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parents[1]
DERIVED_DATA_DIR = BASE_DIR / "data" / "derived"

# Serve derived static files with explicit CORS headers
@app.get("/derived/{full_path:path}")
async def serve_derived(full_path: str):
    from app.core.data_paths import resolve_under
    from fastapi import HTTPException

    try:
        file_path = resolve_under(DERIVED_DATA_DIR, full_path)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="File not found") from exc
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        path=file_path,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Cache-Control": "public, max-age=3600",
        },
    )

app.include_router(health.router)
app.include_router(datasets.router)
app.include_router(public_datasets.router)
app.include_router(admin_auth.router)
app.include_router(admin_datasets.router)
