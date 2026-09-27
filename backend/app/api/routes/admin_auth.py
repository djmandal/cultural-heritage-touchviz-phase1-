from fastapi import APIRouter, Depends, Request, Response

from app.core.admin_auth import (
    LoginRequest,
    create_admin_session,
    require_admin_session,
    revoke_admin_session,
)

router = APIRouter(prefix="/admin/auth", tags=["admin-auth"])


@router.post("/login")
def login(payload: LoginRequest, request: Request, response: Response):
    create_admin_session(payload.password, request, response)
    return {"authenticated": True}


@router.get("/session")
def session(_: None = Depends(require_admin_session)):
    return {"authenticated": True}


@router.post("/logout", dependencies=[Depends(require_admin_session)])
def logout(request: Request, response: Response):
    revoke_admin_session(request, response)
    return {"authenticated": False}
