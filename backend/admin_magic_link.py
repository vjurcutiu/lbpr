"""Admin helper: provision a phone user + generate a one-time magic login link.

Security posture (Option A): run this **inside** the backend container/VM.
This avoids exposing any "create magic link" HTTP endpoint to the public internet.

Examples:
  # Dev
  docker compose -p lbpr-dev -f docker-compose.dev.yml exec api \
    python admin_magic_link.py --phone +40712345678 --base-url http://app.localhost --return-to /files

  # Prod (example)
  docker compose -p lbpr -f docker-compose.yml -f docker-compose.ssl.yml exec api \
    python admin_magic_link.py --phone +40712345678 --base-url https://app.lexbot.pro

cd /opt/lbpr
sudo docker compose \
  -f /opt/lbpr/docker-compose.yml \
  -f /opt/lbpr/ops/deploy/docker-compose.deploy.yml \
  -f /opt/lbpr/docker-compose.ssl.yml \
  -f /opt/lbpr/ops/deploy/docker-compose.doppler.yml \
  exec api bash -lc 'python /app/admin_magic_link.py --phone "+40739420954" --base-url "https://lexbot.pro" --return-to "/files"'
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from urllib.parse import urlencode


def _ensure_import_path() -> None:
    # Ensure imports like `from core...` resolve when running as a script.
    here = os.path.dirname(os.path.abspath(__file__))
    if here and here not in sys.path:
        sys.path.insert(0, here)


def _normalize_base_url(base_url: str | None) -> str:
    base = (base_url or os.getenv("PUBLIC_APP_URL", "") or "").strip().rstrip("/")
    return base


def main() -> int:
    parser = argparse.ArgumentParser(description="Provision a Firebase phone user and generate a magic login link")
    parser.add_argument("--phone", required=True, help="Phone number in E.164 format, e.g. +40712345678")
    parser.add_argument("--base-url", default=None, help="Base app URL, e.g. https://app.lexbot.pro")
    parser.add_argument("--return-to", default=None, help="Optional path to redirect after login (e.g. /files)")
    parser.add_argument("--ttl-seconds", type=int, default=None, help="Invite TTL in seconds (default from env)")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON")
    args = parser.parse_args()

    _ensure_import_path()

    # Init Firebase Admin (service account JSON should already be mounted in the container)
    from core.firebase import init_firebase

    init_firebase()

    from firebase_admin import auth  # type: ignore
    from features.auth.invites import invites

    phone = (args.phone or "").strip()
    if not phone.startswith("+"):
        raise SystemExit("--phone must be in E.164 format (start with +)")

    user_created = False
    try:
        user = auth.get_user_by_phone_number(phone)
    except Exception as e:
        # firebase_admin raises auth.UserNotFoundError, but we avoid tight coupling.
        if e.__class__.__name__ in {"UserNotFoundError", "NotFoundError"}:
            user = auth.create_user(phone_number=phone)
            user_created = True
        else:
            raise

    ttl = args.ttl_seconds
    code, ttl_used = invites.create(user.uid, ttl_seconds=ttl)

    base = _normalize_base_url(args.base_url)
    params: dict[str, str] = {"code": code}
    if args.return_to:
        params["returnTo"] = args.return_to
    link_path = f"/magic?{urlencode(params)}"
    link = f"{base}{link_path}" if base else link_path

    out = {
        "uid": user.uid,
        "phone_number": phone,
        "user_created": user_created,
        "code": code,
        "link": link,
        "expires_in_seconds": ttl_used,
    }

    if args.json:
        print(json.dumps(out, indent=2, sort_keys=True))
    else:
        print(f"UID: {out['uid']}")
        print(f"Phone: {out['phone_number']}")
        print(f"Created: {out['user_created']}")
        print(f"Expires: {out['expires_in_seconds']}s")
        print(f"Link: {out['link']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
