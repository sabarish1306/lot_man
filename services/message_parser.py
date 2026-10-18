import re
import unicodedata
from collections import Counter

from services.text_service import extract_tickets_with_qwen


# Only these separators are unambiguous enough for the initial rules.
PAIR = re.compile(
    r"(?P<number>[0-9]+)[ \t]*[-*][ \t]*(?P<count>[0-9]+)"
)

# Exact acknowledgements only; never discard a message containing more text.
ACKNOWLEDGEMENTS = {"k", "ok", "okay", "👍"}

# Known context that the current ticket-only schema cannot preserve.
CONTEXT_MARKER = re.compile(
    r"\b(?:rs|box|full|off|dc|ab|ac|bc|abc|all|each|set|ch|cha|"
    r"cancel|result|prize|gt)\b",
    re.IGNORECASE,
)


def normalize_message(raw: str) -> str:
    """Create a parsing copy. The caller must retain the original text."""
    text = unicodedata.normalize("NFC", raw)

    return text.translate(str.maketrans({
        "\u00a0": " ",   # Non-breaking space
        "\u202f": " ",   # Narrow non-breaking space
        "\u200e": None,  # Direction-formatting marks
        "\u200f": None,
        "\u2010": "-",
        "\u2011": "-",
        "\u2013": "-",
        "\u2212": "-",
    })).replace("\r\n", "\n").replace("\r", "\n")


def review(reason: str) -> dict:
    return {
        "tickets": [],
        "needs_review": True,
        "review_reason": reason,
    }


def parse_explicit_lines(text: str):
    """
    Return tickets only if EVERY nonempty line is an explicit pair.
    Return None when the message needs another processing route.
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    if not lines:
        return None

    tickets = []

    for line in lines:
        match = PAIR.fullmatch(line)

        if match is None:
            return None

        count = int(match["count"])

        if count <= 0:
            return None

        tickets.append({
            "ticket_number": match["number"],
            "count": count,
        })

    return tickets


def validate_model_evidence(text: str, result: dict) -> dict:
    """
    Conservative initial gate:
    accept model output only when the entire source is explicit pairs.

    More formats can be added after their business rules are confirmed.
    """
    if result.get("needs_review"):
        return review(
            result.get("review_reason") or "Model requested review."
        )

    source_tickets = parse_explicit_lines(text)

    if source_tickets is None:
        return review(
            "Qwen proposed entries, but this source format does not yet "
            "have an independent validation rule."
        )

    proposed = result.get("tickets", [])

    try:
        actual = Counter(
            (item["ticket_number"], item["count"])
            for item in proposed
        )
        expected = Counter(
            (item["ticket_number"], item["count"])
            for item in source_tickets
        )
    except (KeyError, TypeError):
        return review("Invalid model output.")

    if actual != expected:
        return review("Model output does not match the source entries.")

    # Preserve original order rather than the model's order.
    return {
        "tickets": source_tickets,
        "needs_review": False,
        "review_reason": "",
    }


def process_text_message(raw_text: str) -> dict:
    text = normalize_message(raw_text).strip()

    if not text:
        return {"action": "skip", "reason": "empty"}

    if text.casefold() in ACKNOWLEDGEMENTS:
        return {"action": "skip", "reason": "acknowledgement"}

    # Do not lose schemes, shared quantities or cancellation context.
    if CONTEXT_MARKER.search(text):
        return {
            "action": "review",
            "method": "context_guard",
            "extraction": review(
                "Message contains scheme or contextual information that "
                "the current ticket-only schema cannot preserve."
            ),
        }

    tickets = parse_explicit_lines(text)

    if tickets is not None:
        return {
            "action": "draft",
            "method": "rules",
            "extraction": {
                "tickets": tickets,
                "needs_review": False,
                "review_reason": "",
            },
        }

    # Never send the cleaned copy alone: retain the original as evidence.
    model_input = (
        "Original message:\n"
        f"{raw_text}\n\n"
        "Normalized parsing copy:\n"
        f"{text}"
    )

    try:
        suggestion = extract_tickets_with_qwen(model_input)
        extraction = validate_model_evidence(text, suggestion)
    except Exception:
        # Log the exception internally; do not lose the review item.
        extraction = review("Qwen extraction failed.")

    return {
        "action": "review" if extraction["needs_review"] else "draft",
        "method": "qwen",
        "extraction": extraction,
    }