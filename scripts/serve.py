#!/usr/bin/env python3
"""
scripts/serve.py
─────────────────────────────────────────────────────────────────
Combined dev server:
  • Serves frontend/ as static files
  • Exposes GET /api/feed?url=<encoded>  — server-side RSS proxy
    (fetches the feed with Python/urllib, returns raw XML to the
     browser with CORS headers, eliminating all third-party proxies)

Usage:
    python scripts/serve.py            # port 8000
    python scripts/serve.py --port 3000
    python scripts/serve.py --no-open
"""

import argparse
import http.server
import os
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

FRONTEND = Path(__file__).parent.parent / "frontend"
CONFIG   = FRONTEND / "js" / "config.js"
EXAMPLE  = FRONTEND / "js" / "config.example.js"

FETCH_TIMEOUT  = 15          # seconds per feed request
MAX_FEED_BYTES = 2_000_000   # 2 MB safety cap

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; AISignalBot/1.0; "
        "+https://github.com/your-username/ai-signal)"
    ),
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
}


def ensure_config() -> None:
    if CONFIG.exists():
        return
    if not EXAMPLE.exists():
        print("[warn] config.example.js not found", file=sys.stderr)
        return
    shutil.copy(EXAMPLE, CONFIG)
    print("  ┌──────────────────────────────────────────────────────┐")
    print("  │  ACTION REQUIRED                                      │")
    print("  │  Created frontend/js/config.js                       │")
    print("  │  Open it and replace YOUR_GEMINI_API_KEY_HERE        │")
    print("  │  Free key → https://aistudio.google.com/apikey       │")
    print("  └──────────────────────────────────────────────────────┘")


def fetch_feed(url: str) -> tuple[bytes, str]:
    """Fetch a remote URL server-side. Returns (body_bytes, content_type)."""
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
        ct = resp.headers.get_content_type() or "application/xml"
        body = resp.read(MAX_FEED_BYTES)
    return body, ct


class Handler(http.server.SimpleHTTPRequestHandler):

    def log_message(self, fmt, *args):
        # Only log API calls, silence static file noise
        first = str(args[0]) if args else ""
        if "/api/" in first:
            print(f"  [proxy] {first}")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/feed":
            self._handle_feed_proxy(parsed)
        else:
            # Serve static files from frontend/
            super().do_GET()

    def _handle_feed_proxy(self, parsed):
        params = urllib.parse.parse_qs(parsed.query)
        url    = params.get("url", [None])[0]

        if not url:
            self._respond(400, b"Missing ?url= parameter", "text/plain")
            return

        # Basic SSRF guard — only allow http/https
        scheme = urllib.parse.urlparse(url).scheme.lower()
        if scheme not in ("http", "https"):
            self._respond(400, b"Only http/https URLs allowed", "text/plain")
            return

        try:
            body, ct = fetch_feed(url)
            self._respond(200, body, ct)
            print(f"  [proxy] OK  {url[:80]}")
        except urllib.error.HTTPError as e:
            msg = f"Upstream HTTP {e.code}: {url}".encode()
            self._respond(502, msg, "text/plain")
            print(f"  [proxy] {e.code} {url[:80]}")
        except Exception as e:
            msg = f"Fetch error: {e}".encode()
            self._respond(502, msg, "text/plain")
            print(f"  [proxy] ERR {e} — {url[:80]}")

    def _respond(self, code: int, body: bytes, ct: str):
        self.send_response(code)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        if self.path.endswith((".js", ".css", ".html")):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        self.send_header("Cross-Origin-Opener-Policy",   "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser(description="AI Signal dev server + feed proxy.")
    parser.add_argument("--port",    "-p", type=int, default=8000)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()

    if not FRONTEND.exists():
        print(f"[error] frontend/ not found at {FRONTEND}", file=sys.stderr)
        sys.exit(1)

    ensure_config()
    os.chdir(FRONTEND)

    url = f"http://localhost:{args.port}"
    print(f"\n  AI Signal")
    print(f"  ─────────────────────────────────────────")
    print(f"  Frontend  →  {url}")
    print(f"  Feed proxy → {url}/api/feed?url=<encoded>")
    print(f"  Config    →  frontend/js/config.js")
    print(f"  Ctrl+C to stop\n")

    if not args.no_open:
        webbrowser.open(url)

    with http.server.HTTPServer(("", args.port), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Server stopped.")


if __name__ == "__main__":
    main()
