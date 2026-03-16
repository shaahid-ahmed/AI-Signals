"""
src/fetcher/rss.py
Fetches and parses RSS/Atom feeds using feedparser.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Optional

import feedparser

logger = logging.getLogger(__name__)

# ── Source definitions ────────────────────────────────────────────────────────

RSS_SOURCES: list[dict] = [
    {
        "name": "OpenAI",
        "provider": "openai",
        "product": "ChatGPT",
        "urls": [
            "https://openai.com/news/rss.xml",
        ],
    },
    {
        "name": "Anthropic",
        "provider": "anthropic",
        "product": "Claude",
        "urls": [
            # Community-maintained mirror with proper dates
            "https://raw.githubusercontent.com/Olshansk/rss-feeds/refs/heads/main/feeds/feed_anthropic.xml",
            # Native feed as fallback
            "https://www.anthropic.com/rss.xml",
        ],
    },
    {
        "name": "Google DeepMind",
        "provider": "google",
        "product": "Gemini",
        "urls": [
            "https://deepmind.google/blog/rss.xml",
            "https://blog.google/products/gemini/rss/",
        ],
    },
    {
        "name": "Microsoft Copilot",
        "provider": "microsoft",
        "product": "Copilot",
        "urls": [
            "https://techcommunity.microsoft.com/plugins/custom/microsoft/o365/rss-feed-widget"
            "?tid=microsoft.sharepoint.com&channelId=&boardId=Microsoft365CopilotBlog"
            "&search=&numberOfResults=20&userId=",
            "https://www.microsoft.com/en-us/microsoft-copilot/blog/feed/",
            "https://blogs.microsoft.com/blog/feed/",
        ],
    },
]


# ── Data model ────────────────────────────────────────────────────────────────

@dataclass
class FeedItem:
    title: str
    link: str
    pub_date: str
    description: str
    guid: str
    provider: str
    provider_name: str
    product: str

    def to_dict(self) -> dict:
        return {
            "title":         self.title,
            "link":          self.link,
            "pub_date":      self.pub_date,
            "description":   self.description,
            "guid":          self.guid,
            "provider":      self.provider,
            "provider_name": self.provider_name,
            "product":       self.product,
        }


@dataclass
class FetchResult:
    source: str
    items: list[FeedItem] = field(default_factory=list)
    error: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.error is None and len(self.items) > 0


# ── Helpers ───────────────────────────────────────────────────────────────────

def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def _first(*values: str) -> str:
    return next((v for v in values if v), "")


def _parse_feed(
    parsed: feedparser.FeedParserDict,
    provider: str,
    provider_name: str,
    product: str,
) -> list[FeedItem]:
    items: list[FeedItem] = []
    for entry in parsed.entries:
        title = _strip_html(getattr(entry, "title", "")).strip()
        if not title:
            continue

        link = _first(getattr(entry, "link", ""), getattr(entry, "id", ""))
        pub_date = _first(
            getattr(entry, "published", ""),
            getattr(entry, "updated", ""),
        )

        desc = ""
        if hasattr(entry, "content") and entry.content:
            desc = entry.content[0].get("value", "")
        elif hasattr(entry, "summary"):
            desc = entry.summary or ""
        desc = _strip_html(desc)[:500]

        guid = _first(getattr(entry, "id", ""), link, title)
        items.append(FeedItem(
            title=title, link=link, pub_date=pub_date,
            description=desc, guid=guid,
            provider=provider, provider_name=provider_name, product=product,
        ))
    return items


# ── Public API ────────────────────────────────────────────────────────────────

def fetch_source(source: dict) -> FetchResult:
    """Fetches one source, trying each URL in order."""
    errors: list[str] = []

    for url in source["urls"]:
        try:
            parsed = feedparser.parse(url)
            if parsed.bozo and not parsed.entries:
                errors.append(f"{url}: bozo error ({parsed.bozo_exception})")
                continue

            items = _parse_feed(
                parsed,
                provider=source["provider"],
                provider_name=source["name"],
                product=source["product"],
            )
            if items:
                logger.info("Fetched %d items from %s (%s)", len(items), source["name"], url)
                return FetchResult(source=source["name"], items=items)

            errors.append(f"{url}: 0 items")
        except Exception as exc:
            errors.append(f"{url}: {exc}")
            logger.warning("Failed to fetch %s: %s", url, exc)

    return FetchResult(
        source=source["name"],
        items=[],
        error="\n".join(errors) or f"All URLs failed for {source['name']}",
    )


def fetch_all() -> tuple[list[FeedItem], list[FetchResult]]:
    """Fetches all sources. Returns (all_items, fetch_results)."""
    all_items: list[FeedItem] = []
    results: list[FetchResult] = []
    for source in RSS_SOURCES:
        result = fetch_source(source)
        results.append(result)
        all_items.extend(result.items)
    return all_items, results
