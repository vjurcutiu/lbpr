# main.py
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from typing import Optional
import os, sys, datetime

# If you keep .env for local dev, don't override Docker env
from dotenv import load_dotenv
load_dotenv(override=False)

import firebase_admin
from firebase_admin import auth, credentials

DEFAULT_PATH = "/run/secrets/firebase_sa.json"

def choose_cred_path() -> str:
    # Prefer explicit env, otherwise default
    candidates = [os.getenv("FIREBASE_CREDENTIALS"), DEFAULT_PATH]
    for c in candidates:
        if not c:
            continue
        # Ignore obvious host/Windows paths if they don't exist in the container
        if ":" in c and os.name == "posix" and not os.path.exists(c):
            print(f"[startup] Skipping non-existent host path: {c}", file=sys.stderr)
            continue
        if os.path.exists(c):
            print(f"[startup] Using Firebase credentials: {c}", file=sys.stderr)
            return c
        else:
            print(f"[startup] Candidate not found: {c}", file=sys.stderr)
    raise RuntimeError(
        "Firebase service account file not found. "
        f"Tried {candidates}. Mount the JSON and set FIREBASE_CREDENTIALS to an in-container path."
    )

cred_path = choose_cred_path()

if not firebase_admin._apps:
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred, {
        "projectId": os.getenv("FIREBASE_PROJECT_ID")
    })

app = FastAPI(title="RAG API")
COOKIE_NAME = "fb_session"

class SessionOut(BaseModel):
    uid: str
    email: Optional[str] = None
    name: Optional[str] = None
    picture: Optional[str] = None

class EnvelopeOut(BaseModel):
    user: Optional[SessionOut] = None

class CreateSessionIn(BaseModel):
    id_token: str

def get_user_from_cookie(req: Request) -> SessionOut:
    cookie = req.cookies.get(COOKIE_NAME)
    if not cookie:
        raise HTTPException(status_code=401, detail="No session")
    try:
        decoded = auth.verify_session_cookie(cookie, check_revoked=True)
        return SessionOut(
            uid=decoded["uid"],
            email=decoded.get("email"),
            name=decoded.get("name"),
            picture=decoded.get("picture"),
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

router = APIRouter()

@router.get("/healthz")
async def healthz():
    return {"ok": True}

@router.get("/session", response_model=EnvelopeOut)
async def read_session(req: Request):
    user = get_user_from_cookie(req)
    return {"user": user}

@router.post("/auth/session")
async def create_session(resp: Response, payload: CreateSessionIn):
    expires_in = datetime.timedelta(hours=8)
    try:
        session_cookie = auth.create_session_cookie(payload.id_token, expires_in=expires_in)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid ID token")

    resp.set_cookie(
        key=COOKIE_NAME,
        value=session_cookie,
        max_age=int(expires_in.total_seconds()),
        httponly=True,
        secure=False,   # set True in prod (HTTPS)
        samesite="lax",
        path="/",
    )
    return {"ok": True}

@router.post("/auth/logout")
async def logout(resp: Response, req: Request):
    cookie = req.cookies.get(COOKIE_NAME)
    if cookie:
        try:
            decoded = auth.verify_session_cookie(cookie, check_revoked=False)
            auth.revoke_refresh_tokens(decoded["uid"])
        except Exception:
            pass
    resp.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}

app.include_router(router)
app.include_router(router, prefix="/v1")
