#!/usr/bin/env python3
"""
server/proxy.py
Production RSS proxy server using Flask.

Exposes:
  GET /api/feed?url=<encoded>  — fetches the remote feed and returns raw XML
  GET /                        — serves frontend/index.html
  GET /<path>                  — serves frontend static files

Deploy on any Python host (Railway, Render, Fly.io, etc.):

    pip install flask
    python server/proxy.py

Or with gunicorn for production:

    pip install flask gunicorn
    gunicorn -w 2 -b 0.0.0.0:8000 "server.proxy:create_app()"

Environment variables:
    PORT        — port to listen on (default 8000)
    HOST        — host to bind (default 0.0.0.0)
"""

from __future__ import annotations

import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

FRONTEND_DIR   = Path(__file__).parent.parent / "frontend"
FETCH_TIMEOUT  = 15
MAX_BYTES      = 2_000_000

HEADERS = {
    "User-Agent": "AISignalBot/1.0 (+https://github.com/your-username/ai-signal)",
    "Accept":     "application/rss+xml, application/xml, text/xml, */*",
}


def create_app():
    from flask import Flask, Response, request, send_from_directory

    app = Flask(__name__, static_folder=None)

    # ── Feed proxy ──────────────────────────────────────────────
    @app.route("/api/feed")
    def feed_proxy():
        url = request.args.get("url", "").strip()
        if not url:
            return Response("Missing ?url= parameter", status=400)

        scheme = urllib.parse.urlparse(url).scheme.lower()
        if scheme not in ("http", "https"):
            return Response("Only http/https URLs allowed", status=400)

        try:
            req  = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
                ct   = resp.headers.get_content_type() or "application/xml"
                body = resp.read(MAX_BYTES)
            return Response(body, status=200, content_type=ct,
                            headers={"Access-Control-Allow-Origin": "*",
                                     "Cache-Control": "no-store"})
        except urllib.error.HTTPError as e:
            return Response(f"Upstream HTTP {e.code}", status=502)
        except Exception as e:
            return Response(f"Fetch error: {e}", status=502)

    # ── Static files ────────────────────────────────────────────
    @app.route("/")
    def index():
        return send_from_directory(FRONTEND_DIR, "index.html")

    @app.route("/<path:filename>")
    def static_files(filename):
        return send_from_directory(FRONTEND_DIR, filename)

    return app


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    app  = create_app()
    print(f"\n  AI Signal — production server")
    print(f"  ─────────────────────────────────────────────")
    print(f"  Listening on http://{host}:{port}")
    print(f"  Feed proxy: /api/feed?url=<encoded>")
    print(f"  Ctrl+C to stop\n")
    app.run(host=host, port=port)
