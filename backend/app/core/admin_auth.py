import hashlib
import hmac
import os
import secrets
import threading
import time

from fastapi import HTTPException, Request, Response
from pydantic import BaseModel

ADMIN_PASSWORD_ENV = "TOUCHVIZ_ADMIN_PASSWORD"
SESSION_COOKIE = "touchviz_admin_session"
SESSION_TTL_SECONDS = 8 * 60 * 60
_sessions: dict[str, float] = {}
_sessions_lock = threading.Lock()
_login_failures: dict[str, list[float]] = {}
_LOGIN_WINDOW_SECONDS = 15 * 60
_MAX_FAILED_LOGINS = 8


class LoginRequest(BaseModel):
    password: str


def _cookie_secure() -> bool:
    return os.getenv("TOUCHVIZ_ADMIN_COOKIE_SECURE", "false").strip().lower() in {
        "1", "true", "yes", "on"
    }


def _allowed_origins() -> set[str]:
    origins = {
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    }
    lan_ip = os.getenv("TOUCHVIZ_LAN_IP", "").strip()
    if lan_ip:
        origins.update(f"http://{lan_ip}:{port}" for port in (5174, 4173))
    extra_origins = os.getenv("TOUCHVIZ_ADMIN_ORIGINS", "")
    origins.update(origin.strip().rstrip("/") for origin in extra_origins.split(",") if origin.strip())
    return origins


def _check_origin(request: Request) -> None:
    origin = request.headers.get("origin", "").rstrip("/")
    if not origin or origin not in _allowed_origins():
        raise HTTPException(status_code=403, detail="Request origin is not allowed.")


def _check_login_rate(request: Request) -> str:
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    with _sessions_lock:
        failures = [
            failed_at
            for failed_at in _login_failures.get(client_ip, [])
            if failed_at > now - _LOGIN_WINDOW_SECONDS
        ]
        _login_failures[client_ip] = failures
        if len(failures) >= _MAX_FAILED_LOGINS:
            raise HTTPException(status_code=429, detail="Too many failed login attempts. Try again later.")
    return client_ip


def require_admin_session(request: Request) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Admin login required.")

    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = time.time()
    with _sessions_lock:
        expires_at = _sessions.get(digest)
        if expires_at is None or expires_at <= now:
            _sessions.pop(digest, None)
            raise HTTPException(status_code=401, detail="Admin session expired.")
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            _check_origin(request)


def create_admin_session(password: str, request: Request, response: Response) -> None:
    client_ip = _check_login_rate(request)
    configured_password = os.getenv(ADMIN_PASSWORD_ENV, "")
    if len(configured_password) < 16:
        raise HTTPException(
            status_code=503,
            detail=f"Admin login is not configured. Set {ADMIN_PASSWORD_ENV} to a password with at least 16 characters.",
        )

    if os.getenv("TOUCHVIZ_ENV", "").strip().lower() == "production" and not _cookie_secure():
        raise HTTPException(
            status_code=503,
            detail="Admin sessions in production require TOUCHVIZ_ADMIN_COOKIE_SECURE=true and HTTPS.",
        )

    if not hmac.compare_digest(password.encode("utf-8"), configured_password.encode("utf-8")):
        now = time.time()
        with _sessions_lock:
            _login_failures.setdefault(client_ip, []).append(now)
        raise HTTPException(status_code=401, detail="Incorrect password.")

    _check_origin(request)
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = time.time()
    with _sessions_lock:
        _login_failures.pop(client_ip, None)
        for old_digest, expires_at in list(_sessions.items()):
            if expires_at <= now:
                _sessions.pop(old_digest, None)
        _sessions[digest] = now + SESSION_TTL_SECONDS

    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=_cookie_secure(),
        samesite="strict",
        path="/admin",
    )


def revoke_admin_session(request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        with _sessions_lock:
            _sessions.pop(digest, None)
    response.delete_cookie(
        key=SESSION_COOKIE,
        httponly=True,
        secure=_cookie_secure(),
        samesite="strict",
        path="/admin",
    )
