"""Exact lookup of persisted final tickets only; never scans import evidence."""
import re
from pathlib import Path
from services.ticket_store import TicketStore


def search_tickets(tickets_dir: Path, business_date: str, ticket_number: str) -> dict:
    if not re.fullmatch(r"[0-9]+", ticket_number):
        raise ValueError("Ticket number must contain ASCII digits only.")
    daily = TicketStore(tickets_dir).list(business_date)
    matches = [r for r in daily["records"] if r["ticket_number"] == ticket_number]
    return {"business_date": daily["business_date"], "ticket_number": ticket_number,
            "matches": matches, "match_count": len(matches)}
