import os, sys
from core.config import settings

def choose_cred_path() -> str:
    candidates = [settings.FIREBASE_CREDENTIALS, settings.FIREBASE_CREDENTIALS_DEFAULT]
    last = None
    for c in candidates:
        if not c:
            continue
        last = c
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

# Lazy init wrapper so tests can stub firebase_admin easily
_firebase_initialized = False

def init_firebase():
    global _firebase_initialized
    if _firebase_initialized:
        return

    import firebase_admin
    from firebase_admin import credentials

    cred_path = choose_cred_path()
    if not firebase_admin._apps:
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred, {"projectId": settings.FIREBASE_PROJECT_ID})
        _firebase_initialized = True
