"""
src/utils/dedup.py
Deduplication helpers for feed items.
Mirrors the logic in frontend/js/dedup.js.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

from src.fetcher.rss import FeedItem

# ── Normalisation ────────────────────────────────────────────────────────────

def normalise_title(title: str) -> str:
    """Collision key: lowercase, alphanumeric only, first 60 chars."""
    return re.sub(r"[^a-z0-9]", "", title.lower())[:60]


# ── File-backed dedup state (CLI equivalent of localStorage) ────────────────

DEFAULT_STATE_FILE = Path(".ai_signal_seen.json")


def load_seen_guids(state_file: Path = DEFAULT_STATE_FILE) -> set[str]:
    """Loads previously seen GUIDs from a JSON file on disk."""
    if not state_file.exists():
        return set()
    try:
        return set(json.loads(state_file.read_text()))
    except Exception:
        return set()


def save_seen_guids(guids: set[str], state_file: Path = DEFAULT_STATE_FILE, cap: int = 500) -> None:
    """Persists the seen-GUID set, capping at `cap` entries."""
    arr = list(guids)[-cap:]
    state_file.write_text(json.dumps(arr, indent=2))


def clear_seen_guids(state_file: Path = DEFAULT_STATE_FILE) -> None:
    """Removes the state file (reset dedup)."""
    state_file.unlink(missing_ok=True)


# ── Main dedup ───────────────────────────────────────────────────────────────

def deduplicate(
    items: list[FeedItem],
    seen_guids: set[str],
) -> tuple[list[FeedItem], int, int]:
    """
    Returns (fresh_items, dup_count, seen_count).

    Layer 1 — within-run: normalised title collision.
    Layer 2 — cross-run: GUID already in seen_guids.
    """
    title_seen: dict[str, bool] = {}
    after_layer1: list[FeedItem] = []
    dup_count = 0

    for item in items:
        key = normalise_title(item.title)
        if key in title_seen:
            dup_count += 1
        else:
            title_seen[key] = True
            after_layer1.append(item)

    fresh: list[FeedItem] = []
    seen_count = 0

    for item in after_layer1:
        if item.guid in seen_guids:
            seen_count += 1
        else:
            fresh.append(item)

    return fresh, dup_count, seen_count


def mark_seen(items: list[FeedItem], seen_guids: set[str]) -> None:
    """Adds item GUIDs to the seen set (mutates in place)."""
    for item in items:
        seen_guids.add(item.guid)
