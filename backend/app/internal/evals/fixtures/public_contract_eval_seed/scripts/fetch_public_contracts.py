#!/usr/bin/env python3
"""Fetch public legal eval contracts from manifest.json.

Run from the dataset root:

    python scripts/fetch_public_contracts.py

Dependencies:

    pip install requests beautifulsoup4

For SEC.gov, set a real contact if possible:

    SEC_USER_AGENT="your-app-name your-email@example.com" python scripts/fetch_public_contracts.py
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError as exc:
    raise SystemExit("Missing dependency. Run: pip install requests beautifulsoup4") from exc

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "manifest.json"
SEC_USER_AGENT = os.environ.get("SEC_USER_AGENT", "LBPR legal eval fixture downloader contact@example.com")

HTML_HEADERS = {
    "User-Agent": SEC_USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
}
BINARY_HEADERS = {
    "User-Agent": SEC_USER_AGENT,
    "Accept": "application/octet-stream,application/pdf,*/*;q=0.5",
}


def html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()
    text = soup.get_text("\n")
    lines = []
    for line in text.splitlines():
        cleaned = re.sub(r"\s+", " ", line).strip()
        if cleaned:
            lines.append(cleaned)
    return "\n".join(lines).strip() + "\n"


def should_save_binary(path: Path) -> bool:
    return path.suffix.lower() in {".pdf", ".odt", ".docx", ".xlsx"}


def fetch_one(entry: dict[str, Any]) -> str:
    local_path = entry.get("local_path")
    if not local_path:
        return "skipped:no_local_path"

    out_path = ROOT / local_path
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if out_path.exists() and out_path.stat().st_size > 0:
        return "exists"

    url = entry.get("raw_url") or entry.get("url")
    if not url:
        return "skipped:no_url"

    headers = BINARY_HEADERS if should_save_binary(out_path) else HTML_HEADERS
    resp = requests.get(url, headers=headers, timeout=60)
    resp.raise_for_status()

    if should_save_binary(out_path):
        out_path.write_bytes(resp.content)
        return "downloaded_binary"

    content_type = resp.headers.get("content-type", "").lower()
    if "html" in content_type or url.endswith((".htm", ".html", "/")):
        text = html_to_text(resp.text)
    else:
        text = resp.text

    header = (
        f"Source title: {entry.get('title', '')}\n"
        f"Source URL: {url}\n"
        f"Document type: {entry.get('document_type', '')}\n\n---\n\n"
    )
    out_path.write_text(header + text, encoding="utf-8")
    return "downloaded_text"


def main() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    results: list[dict[str, str]] = []

    for i, entry in enumerate(manifest.get("contracts", []), start=1):
        entry_id = entry.get("id", f"entry_{i}")
        try:
            status = fetch_one(entry)
        except Exception as exc:  # continue through failures
            status = f"error:{type(exc).__name__}:{exc}"
        results.append({"id": entry_id, "status": status})
        print(f"[{i}] {entry_id}: {status}")
        if "sec.gov" in (entry.get("url") or ""):
            time.sleep(0.2)

    (ROOT / "sources" / "fetch_results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
