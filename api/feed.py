"""
api/feed.py — Vercel serverless function
Handles: GET /api/feed?url=<encoded>

Vercel detects this file automatically and exposes it at /api/feed.
No Flask needed — Vercel calls the `handler` function directly via WSGI.
"""

from http.server import BaseHTTPRequestHandler
import urllib.error
import urllib.parse
import urllib.request

FETCH_TIMEOUT = 15
MAX_BYTES     = 2_000_000

HEADERS = {
    "User-Agent": "AISignalBot/1.0",
    "Accept":     "application/rss+xml, application/xml, text/xml, */*",
}


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        url    = params.get("url", [None])[0]

        if not url:
            self._respond(400, b"Missing ?url= parameter", "text/plain")
            return

        scheme = urllib.parse.urlparse(url).scheme.lower()
        if scheme not in ("http", "https"):
            self._respond(400, b"Only http/https URLs allowed", "text/plain")
            return

        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
                ct   = resp.headers.get_content_type() or "application/xml"
                body = resp.read(MAX_BYTES)
            self._respond(200, body, ct)
        except urllib.error.HTTPError as e:
            self._respond(502, f"Upstream HTTP {e.code}".encode(), "text/plain")
        except Exception as e:
            self._respond(502, f"Fetch error: {e}".encode(), "text/plain")

    def _respond(self, code: int, body: bytes, ct: str):
        self.send_response(code)
        self.send_header("Content-Type",                  ct)
        self.send_header("Content-Length",                str(len(body)))
        self.send_header("Access-Control-Allow-Origin",   "*")
        self.send_header("Cache-Control",                 "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # suppress Vercel log noise
