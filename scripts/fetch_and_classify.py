#!/usr/bin/env python3
"""
scripts/fetch_and_classify.py
CLI tool: fetch all RSS sources, dedup, classify, and write a JSON report.

Usage:
    python scripts/fetch_and_classify.py
    python scripts/fetch_and_classify.py --output results.json
    python scripts/fetch_and_classify.py --reset-dedup   # clear seen-GUIDs state
    python scripts/fetch_and_classify.py --dry-run       # fetch + dedup only, no API call
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Add repo root to path so `src` is importable without installing the package
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

from src.agent.classifier import classify_all
from src.fetcher.rss import fetch_all
from src.utils.dates import format_date, parse_date, relative_age
from src.utils.dedup import (
    clear_seen_guids,
    deduplicate,
    load_seen_guids,
    mark_seen,
    save_seen_guids,
)

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ── CLI ──────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Fetch AI company RSS feeds, classify items as signal/noise, output JSON.",
    )
    p.add_argument(
        "--output", "-o",
        metavar="FILE",
        help="Write JSON results to FILE (default: print to stdout)",
    )
    p.add_argument(
        "--reset-dedup",
        action="store_true",
        help="Clear the local seen-GUID state before running",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and dedup only — skip the Anthropic API call",
    )
    p.add_argument(
        "--batch-size",
        type=int,
        default=20,
        metavar="N",
        help="Items per classification batch (default: 20)",
    )
    p.add_argument(
        "--no-dedup",
        action="store_true",
        help="Disable cross-run dedup (process all fetched items)",
    )
    return p


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    load_dotenv()
    args = build_parser().parse_args()

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not args.dry_run and not api_key:
        logger.error("GEMINI_API_KEY not set. Get a free key at https://aistudio.google.com/apikey")
        sys.exit(1)

    if args.reset_dedup:
        clear_seen_guids()
        logger.info("Dedup state cleared.")

    run_start = time.monotonic()

    # ── 1. Fetch ─────────────────────────────────────────────────────────────

    logger.info("Fetching RSS feeds…")
    all_items, fetch_results = fetch_all()
    total_fetched = len(all_items)

    for r in fetch_results:
        status = f"{r.count} items" if r.ok else f"✗ {r.error}"
        logger.info("  %-20s %s", r.source, status)

    logger.info("Total fetched: %d items", total_fetched)

    # ── 2. Dedup ──────────────────────────────────────────────────────────────

    seen_guids = set() if args.no_dedup else load_seen_guids()
    fresh, dup_count, seen_count = deduplicate(all_items, seen_guids)

    logger.info(
        "Dedup: %d within-run duplicates, %d already seen → %d fresh items",
        dup_count, seen_count, len(fresh),
    )

    if not fresh:
        logger.info("Nothing new — exiting.")
        _write_output(
            args,
            accepted=[], rejected=[],
            stats={
                "total_fetched": total_fetched,
                "dedup_removed": dup_count + seen_count,
                "fresh": 0,
                "accepted": 0,
                "rejected": 0,
                "runtime_s": round(time.monotonic() - run_start, 2),
            },
        )
        return

    # ── 3. Classify ───────────────────────────────────────────────────────────

    accepted_items = []
    rejected_items = []

    if args.dry_run:
        logger.info("--dry-run: skipping classification.")
        for item in fresh:
            rejected_items.append({
                "title":         item.title,
                "link":          item.link,
                "provider":      item.provider,
                "provider_name": item.provider_name,
                "pub_date_raw":  item.pub_date,
                "pub_date":      format_date(parse_date(item.pub_date)),
                "age":           relative_age(parse_date(item.pub_date)),
                "decision":      "UNKNOWN",
                "category":      "dry_run",
                "reason":        "Dry run — classification skipped.",
            })
    else:
        logger.info("Classifying %d items (batch size %d)…", len(fresh), args.batch_size)
        classification_map = classify_all(fresh, api_key, batch_size=args.batch_size)

        for item in fresh:
            cl = classification_map.get(item.guid)
            dt = parse_date(item.pub_date)
            row = {
                "title":         item.title,
                "link":          item.link,
                "provider":      item.provider,
                "provider_name": item.provider_name,
                "pub_date_raw":  item.pub_date,
                "pub_date":      format_date(dt),
                "age":           relative_age(dt),
                "decision":      cl.decision if cl else "NOISE",
                "category":      cl.category if cl else "other",
                "reason":        cl.reason   if cl else "No classification.",
            }
            if cl and cl.is_signal():
                accepted_items.append(row)
            else:
                rejected_items.append(row)

    # Sort both lists newest-first by pub_date_raw
    def sort_key(row: dict) -> float:
        dt = parse_date(row.get("pub_date_raw", ""))
        return dt.timestamp() if dt else 0.0

    accepted_items.sort(key=sort_key, reverse=True)
    rejected_items.sort(key=sort_key, reverse=True)

    # Persist seen GUIDs
    if not args.no_dedup:
        mark_seen(fresh, seen_guids)
        save_seen_guids(seen_guids)

    # ── 4. Output ──────────────────────────────────────────────────────────────

    stats = {
        "total_fetched":  total_fetched,
        "dedup_removed":  dup_count + seen_count,
        "fresh":          len(fresh),
        "accepted":       len(accepted_items),
        "rejected":       len(rejected_items),
        "runtime_s":      round(time.monotonic() - run_start, 2),
    }

    logger.info(
        "Done — accepted: %d, rejected: %d, runtime: %.1fs",
        stats["accepted"], stats["rejected"], stats["runtime_s"],
    )

    _write_output(args, accepted=accepted_items, rejected=rejected_items, stats=stats)


def _write_output(args: argparse.Namespace, accepted: list, rejected: list, stats: dict) -> None:
    output = {
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
        "stats":        stats,
        "accepted":     accepted,
        "rejected":     rejected,
    }
    serialised = json.dumps(output, indent=2, ensure_ascii=False)

    if args.output:
        Path(args.output).write_text(serialised, encoding="utf-8")
        logger.info("Results written to %s", args.output)
    else:
        print(serialised)


if __name__ == "__main__":
    main()
