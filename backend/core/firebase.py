import os
import sys
from core.config import settings

# Internal flag for lazy, idempotent init
_firebase_initialized = False


def _should_skip_init() -> bool:
    """
    Decide whether to skip Firebase initialization.

    Priority:
      - Explicit SKIP_FIREBASE_INIT=1
      - Conventional test signals (APP_ENV=test, running under pytest)
    """
    if os.getenv("SKIP_FIREBASE_INIT") == "1":
        return True
    if os.getenv("APP_ENV", "").lower() == "test":
        return True
    if os.getenv("PYTEST_CURRENT_TEST"):
        return True
    return False


def choose_cred_path() -> str:
    """
    Return a path to a Firebase service account JSON file.

    Order of precedence:
      1) GOOGLE_APPLICATION_CREDENTIALS
      2) settings.FIREBASE_CREDENTIALS
      3) settings.FIREBASE_CREDENTIALS_DEFAULT

    Notes:
      - On Linux containers, Windows host paths like "C:/..." won't exist.
        We log a helpful message in that case.
    """
    env_gac = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    candidates = [
        env_gac,
        settings.FIREBASE_CREDENTIALS,
        settings.FIREBASE_CREDENTIALS_DEFAULT,
    ]

    for c in candidates:
        if not c:
            continue

        # If we're inside Linux container and someone passed a Windows host path, warn once.
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
    """
    Lazily initialize firebase_admin with a service account.

    - No-op if already initialized.
    - Skips entirely in tests when _should_skip_init() is True.
    """
    global _firebase_initialized
    if _firebase_initialized:
        return

    # Allow tests to opt out of real Firebase Admin initialization.
    if _should_skip_init():
        print("[startup] SKIP_FIREBASE_INIT active — skipping Firebase Admin init.", file=sys.stderr)
        _firebase_initialized = True
        return

    import firebase_admin
    from firebase_admin import credentials

    # If another part already initialized the default app, just mark done.
    if getattr(firebase_admin, "_apps", None):
        _firebase_initialized = True
        return

    cred_path = choose_cred_path()
    cred = credentials.Certificate(cred_path)

    # projectId can be inferred from the SA file, but keeping your explicit override:
    firebase_admin.initialize_app(cred, {"projectId": settings.FIREBASE_PROJECT_ID})
    _firebase_initialized = True
