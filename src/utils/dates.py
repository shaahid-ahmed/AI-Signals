"""
src/utils/dates.py
Date parsing and formatting helpers.
"""

from __future__ import annotations

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Optional


def parse_date(raw: str) -> Optional[datetime]:
    """
    Attempts to parse a date string in common feed formats.
    Returns a timezone-aware datetime in UTC, or None on failure.
    """
    if not raw:
        return None

    # RFC 2822 (common in RSS 2.0)
    try:
        dt = parsedate_to_datetime(raw)
        return dt.astimezone(timezone.utc)
    except Exception:
        pass

    # ISO 8601 variants (common in Atom)
    for fmt in (
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            dt = datetime.strptime(raw.strip(), fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except ValueError:
            pass

    return None


def format_date(dt: Optional[datetime]) -> str:
    """Returns 'Mon D, YYYY' or 'Unknown'."""
    if not dt:
        return "Unknown"
    return dt.strftime("%b %-d, %Y")


def relative_age(dt: Optional[datetime]) -> str:
    """Returns a human-readable relative age string."""
    if not dt:
        return ""

    now = datetime.now(tz=timezone.utc)
    diff = now - dt
    days = diff.days

    if days < 1:
        return "today"
    if days == 1:
        return "1 day ago"
    if days < 7:
        return f"{days} days ago"
    if days < 14:
        return "1 week ago"
    if days < 30:
        return f"{days // 7} weeks ago"
    if days < 60:
        return "1 month ago"
    if days < 365:
        return f"{days // 30} months ago"
    years = days // 365
    return "1 year ago" if years == 1 else f"{years} years ago"
