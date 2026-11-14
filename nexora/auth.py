import os
from hmac import compare_digest
from typing import Annotated

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

bearer = HTTPBearer(auto_error=False)
Credentials = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]


def internal(credentials: Credentials):
    if not credentials or not compare_digest(
        credentials.credentials.encode(), os.environ["SERVICE_KEY"].encode()
    ):
        raise HTTPException(401, "SERVICE_AUTH_REQUIRED")


def console(credentials: Credentials):
    if credentials:
        for role in ("admin", "operator", "viewer"):
            secret = os.environ.get(f"{role.upper()}_KEY")
            if secret and compare_digest(
                credentials.credentials.encode(), secret.encode()
            ):
                return role
    raise HTTPException(401, "LOGIN_REQUIRED")


def operator(role: Annotated[str, Depends(console)]):
    if role == "viewer":
        raise HTTPException(403, "ROLE_FORBIDDEN")
    return role


def lab_admin(role: Annotated[str, Depends(console)]):
    if os.getenv("LAB_MODE") != "1" or role != "admin":
        raise HTTPException(403, "LAB_FORBIDDEN")
    return role
