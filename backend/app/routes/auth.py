import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
bearer_scheme = HTTPBearer(auto_error=False)

TOKEN_LIFETIME_SECONDS = 8 * 60 * 60


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)


def _secret_key() -> bytes:
    secret = os.getenv("ACCESSPULSE_SECRET_KEY", "")
    if len(secret) < 32:
        raise RuntimeError(
            "ACCESSPULSE_SECRET_KEY must contain at least 32 characters."
        )
    return secret.encode("utf-8")


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _sign(payload: str) -> str:
    digest = hmac.new(
        _secret_key(), payload.encode("ascii"), hashlib.sha256
    ).digest()
    return _b64encode(digest)


def create_token(username: str) -> str:
    payload_data = {
        "sub": username,
        "exp": int(time.time()) + TOKEN_LIFETIME_SECONDS,
    }
    payload = _b64encode(
        json.dumps(payload_data, separators=(",", ":")).encode("utf-8")
    )
    signed_data = f"v1.{payload}"
    return f"{signed_data}.{_sign(signed_data)}"


def verify_token(token: str) -> str | None:
    try:
        version, payload, signature = token.split(".")
        signed_data = f"{version}.{payload}"

        if version != "v1":
            return None
        if not secrets.compare_digest(_sign(signed_data), signature):
            return None

        decoded = base64.urlsafe_b64decode(
            payload + "=" * (-len(payload) % 4)
        )
        data = json.loads(decoded)

        username = os.getenv("ACCESSPULSE_ADMIN_USERNAME", "")
        if data.get("sub") != username:
            return None
        if not isinstance(data.get("exp"), int):
            return None
        if data["exp"] <= int(time.time()):
            return None

        return username
    except (ValueError, TypeError, json.JSONDecodeError, RuntimeError):
        return None


def require_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Admin login required.")

    username = verify_token(credentials.credentials)
    if username is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired admin session. Please log in again.",
        )
    return username


@router.post("/login")
def login(body: LoginRequest):
    admin_username = os.getenv("ACCESSPULSE_ADMIN_USERNAME", "")
    admin_password = os.getenv("ACCESSPULSE_ADMIN_PASSWORD", "")

    if not admin_username or not admin_password:
        raise HTTPException(
            status_code=503,
            detail="Admin credentials are not configured on the server.",
        )

    # Compare as UTF-8 bytes: compare_digest raises TypeError for
    # non-ASCII str values, which used to cause a 500 error.
    username_ok = secrets.compare_digest(
        body.username.encode("utf-8"), admin_username.encode("utf-8")
    )
    password_ok = secrets.compare_digest(
        body.password.encode("utf-8"), admin_password.encode("utf-8")
    )

    if not (username_ok and password_ok):
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password.",
        )

    return {
        "access_token": create_token(admin_username),
        "token_type": "bearer",
        "expires_in": TOKEN_LIFETIME_SECONDS,
        "username": admin_username,
    }