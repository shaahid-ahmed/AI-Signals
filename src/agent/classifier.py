"""
src/agent/classifier.py
Classifies feed items as SIGNAL or NOISE using the Google Gemini API.

Free tier (gemini-2.0-flash-lite):
  - 15 requests/min, 1,500 requests/day, 1M tokens/min
  - No credit card required
  - Get a key at: https://aistudio.google.com/apikey
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass

import google.generativeai as genai

from src.fetcher.rss import FeedItem

logger = logging.getLogger(__name__)

MODEL       = "gemini-2.0-flash-lite"
BATCH_SIZE  = 15      # conservative for 15 RPM free-tier limit
RPM_DELAY_S = 4.2     # ~14 req/min to stay under 15 RPM

SYSTEM_INSTRUCTION = """You are an AI product news classifier. Analyse blog post titles and summaries from AI companies (OpenAI, Anthropic, Google, Microsoft) and classify each as SIGNAL or NOISE.

SIGNAL (include): new model releases, product feature announcements, API updates, capability launches, significant platform integrations.
NOISE (exclude): tutorials, how-to guides, case studies, safety/policy essays, company culture posts, recaps, event announcements, marketing without a new product.

Return a JSON array with one object per item:
  "index": integer (0-based)
  "decision": "SIGNAL" | "NOISE"
  "category": one of [model_release, feature_update, api_update, capability_announcement, research, policy_or_safety, tutorial, case_study, marketing, event, recap, other]
  "reason": one sentence (25 words max)

Output ONLY the JSON array. No markdown, no preamble. Every index must appear once. Default to NOISE if unsure."""


@dataclass
class Classification:
    index: int
    decision: str
    category: str
    reason: str
    guid: str = ""

    def is_signal(self) -> bool:
        return self.decision == "SIGNAL"

    def to_dict(self) -> dict:
        return {"decision": self.decision, "category": self.category,
                "reason": self.reason, "guid": self.guid}


def _classify_batch(batch: list[FeedItem], model: genai.GenerativeModel) -> list[Classification]:
    user_text = "\n\n".join(
        f"[{i}] TITLE: {item.title}\nSUMMARY: {item.description or 'N/A'}"
        for i, item in enumerate(batch)
    )

    response = model.generate_content(
        user_text,
        generation_config=genai.GenerationConfig(
            temperature=0.1,
            response_mime_type="application/json",
        ),
    )

    raw = response.text.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
    parsed = json.loads(raw)
    if not isinstance(parsed, list):
        raise ValueError(f"Expected JSON array, got: {type(parsed)}")

    results = []
    for entry in parsed:
        idx = entry.get("index", -1)
        item = batch[idx] if 0 <= idx < len(batch) else None
        results.append(Classification(
            index=idx,
            decision=entry.get("decision", "NOISE"),
            category=entry.get("category", "other"),
            reason=entry.get("reason", ""),
            guid=item.guid if item else "",
        ))
    return results


def classify_all(items: list[FeedItem], api_key: str, batch_size: int = BATCH_SIZE) -> dict[str, Classification]:
    """Classify all items in batches. Returns guid -> Classification map."""
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(model_name=MODEL, system_instruction=SYSTEM_INSTRUCTION)
    result_map: dict[str, Classification] = {}

    for start in range(0, len(items), batch_size):
        batch = items[start: start + batch_size]
        logger.info("Classifying batch %d-%d / %d", start + 1, min(start + batch_size, len(items)), len(items))

        try:
            classifications = _classify_batch(batch, model)
        except Exception as exc:
            logger.error("Batch failed: %s", exc)
            classifications = [
                Classification(index=i, decision="NOISE", category="other",
                               reason=f"Error: {exc}", guid=item.guid)
                for i, item in enumerate(batch)
            ]

        for cl in classifications:
            if cl.guid:
                result_map[cl.guid] = cl

        if start + batch_size < len(items):
            time.sleep(RPM_DELAY_S)

    # Fallback for unclassified items
    for item in items:
        if item.guid not in result_map:
            result_map[item.guid] = Classification(
                index=-1, decision="NOISE", category="other",
                reason="No classification returned.", guid=item.guid)

    return result_map
