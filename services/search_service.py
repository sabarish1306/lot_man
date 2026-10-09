"""Read-only exact ticket lookup across completed imports for a business date."""

import json
import logging
import re
from datetime import date
from pathlib import Path

from logging_config import logged_operation

logger = logging.getLogger("mani.search")


def _record_tickets(record: dict, record_type: str) -> list:
    if record_type == "draft":
        tickets = record.get("tickets")
    else:
        details = record.get("details")
        if not isinstance(details, dict):
            return []
        extraction = details.get("extraction", details)
        if not isinstance(extraction, dict):
            return []
        tickets = extraction.get("tickets", [])
    if not isinstance(tickets, list) or any(
        not isinstance(ticket, dict)
        or not isinstance(ticket.get("ticket_number"), str)
        or type(ticket.get("count")) is not int
        or ticket["count"] <= 0
        for ticket in tickets
    ):
        raise ValueError("Stored ticket data has an unsupported format.")
    return tickets


@logged_operation(logger, "Daily ticket lookup")
def search_tickets(imports_dir: Path, business_date: str, ticket_number: str) -> dict:
    # Validate direct service calls as well as HTTP requests. Never coerce tickets
    # to integers: leading zeros are significant.
    if date.fromisoformat(business_date).isoformat() != business_date:
        raise ValueError("Use a business date in YYYY-MM-DD format.")
    if not re.fullmatch(r"[0-9]+", ticket_number):
        raise ValueError("Ticket number must contain digits only.")

    matches = []
    warnings = []
    searched_import_count = 0
    for directory in sorted(imports_dir.iterdir(), key=lambda item: item.name):
        if (not re.fullmatch(r"[0-9a-f]{32}", directory.name)
                or directory.is_symlink() or not directory.is_dir()):
            continue
        path = directory / "result.json"
        if not path.exists():
            # Failed and in-flight uploads have no saved extraction to search.
            continue
        try:
            if path.is_symlink():
                raise ValueError("Stored result must be a regular file.")
            result = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(result, dict) or not isinstance(result.get("business_date"), str):
                raise ValueError("Stored result has no business date.")
            date.fromisoformat(result["business_date"])
            if result["business_date"] != business_date:
                continue
            if (result.get("import_id") != directory.name
                    or not isinstance(result.get("import_timestamp"), str)
                    or not isinstance(result.get("status"), str)):
                raise ValueError("Stored import metadata has an unsupported format.")

            # Build each import's matches before committing, so corrupt records
            # cannot produce a misleading partial result for that import.
            import_matches = []
            for record_type, key in (("draft", "drafts"), ("review", "issues")):
                records = result.get(key)
                if not isinstance(records, list):
                    raise ValueError("Stored records have an unsupported format.")
                for record_index, record in enumerate(records):
                    if not isinstance(record, dict):
                        raise ValueError("Stored record has an unsupported format.")
                    for ticket_index, ticket in enumerate(_record_tickets(record, record_type)):
                        if ticket["ticket_number"] != ticket_number:
                            continue
                        import_matches.append({
                            "import_id": directory.name,
                            "import_timestamp": result["import_timestamp"],
                            "business_date": result["business_date"],
                            "import_status": result["status"],
                            "party": result.get("party"),
                            "record_type": record_type,
                            "record_index": record_index,
                            "ticket_index": ticket_index,
                            "ticket": ticket,
                            # Preserve the complete source record and sibling
                            # tickets, not just fields projected into a table.
                            "record": record,
                        })
            matches.extend(import_matches)
            searched_import_count += 1
        except (OSError, ValueError, UnicodeError):
            logger.warning("Stored import could not be searched import_id=%s", directory.name, exc_info=True)
            warnings.append({
                "import_id": directory.name,
                "reason": "Saved result could not be read or has an unsupported format. Search may be incomplete.",
            })

    # Stable order across imports; preserve record and ticket order within each.
    matches.sort(key=lambda match: (match["import_timestamp"], match["import_id"]))
    logger.info(
        "Daily ticket lookup finished business_date=%s imports=%d matches=%d unreadable=%d",
        business_date, searched_import_count, len(matches), len(warnings),
    )
    return {
        "business_date": business_date,
        "ticket_number": ticket_number,
        "match_count": len(matches),
        "matched_import_count": len({match["import_id"] for match in matches}),
        "searched_import_count": searched_import_count,
        "matches": matches,
        "warnings": warnings,
    }
