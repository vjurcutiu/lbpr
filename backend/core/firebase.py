
import os
import sys
import logging
from core.config import settings

log = logging.getLogger("firebase")

_firebase_initialized = False

def _should_skip_init() -> bool:
    if os.getenv("SKIP_FIREBASE_INIT") == "1":
        return True
    if os.getenv("APP_ENV", "").lower() == "test":
        return True
    if os.getenv("PYTEST_CURRENT_TEST"):
        return True
    return False

def choose_cred_path() -> str:
    env_gac = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    candidates = [
        env_gac,
        settings.FIREBASE_CREDENTIALS,
        settings.FIREBASE_CREDENTIALS_DEFAULT,
    ]

    for c in candidates:
        if not c:
            continue
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
        f"Tried {[env_gac, settings.FIREBASE_CREDENTIALS, settings.FIREBASE_CREDENTIALS_DEFAULT]}. "
        "Mount the JSON and set FIREBASE_CREDENTIALS (or GOOGLE_APPLICATION_CREDENTIALS) "
        "to an in-container path."
    )

def init_firebase():
    global _firebase_initialized
    if _firebase_initialized:
        return
    if _should_skip_init():
        print("[startup] SKIP_FIREBASE_INIT active — skipping Firebase Admin init.", file=sys.stderr)
        _firebase_initialized = True
        return

    import firebase_admin
    from firebase_admin import credentials

    if getattr(firebase_admin, "_apps", None):
        _firebase_initialized = True
        return

    cred_path = choose_cred_path()
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred, {"projectId": settings.FIREBASE_PROJECT_ID})
    log.info("firebase_initialized", project=settings.FIREBASE_PROJECT_ID)
    _firebase_initialized = True
