"""V1 final-ticket storage. Lock order: catalog, then business date.

Receipts and tickets share one atomic document. A catalog lock serializes
cross-date receipt scans so retries after midnight cannot create new batches.
"""
import hashlib
import json
import logging
import os
import re
import tempfile
from datetime import date, datetime
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

from filelock import FileLock, Timeout
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

logger = logging.getLogger("mani.tickets")
IST = ZoneInfo("Asia/Kolkata")
ID_PATTERN = r"^[0-9a-f]{32}$"


class StoreError(Exception):
    """Unavailable/corrupt storage must never be treated as empty."""


class ConflictError(Exception):
    pass


def business_now():
    return datetime.now(IST)


def validate_date(value: str) -> str:
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValueError("Enter a valid business date in YYYY-MM-DD format.")
    date.fromisoformat(value)
    return value


def clean_party(value):
    if not value.strip():
        raise ValueError("Party must not be empty.")
    return value.strip()


class TicketInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    ticket_number: str = Field(pattern=r"^[0-9]+$")
    count: StrictInt = Field(gt=0)


class ManualTicket(TicketInput):
    party: str
    _party = field_validator("party")(clean_party)


class BulkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    tickets: list[ManualTicket] = Field(min_length=1)


class ConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    import_id: str = Field(pattern=ID_PATTERN)
    message_id: str = Field(pattern=ID_PATTERN)
    party: str
    tickets: list[TicketInput] = Field(min_length=1)
    _party = field_validator("party")(clean_party)


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode("utf-8")).hexdigest()


def _timestamp(value):
    if not isinstance(value, str) or datetime.fromisoformat(value).utcoffset() is None:
        raise ValueError("Timestamp must include timezone.")


class TicketStore:
    def __init__(self, directory: Path):
        self.directory = Path(directory)

    def _lock(self, name):
        self.directory.mkdir(parents=True, exist_ok=True)
        return FileLock(self.directory / name, timeout=30)

    def _read(self, day):
        path = self.directory / f"{day}.json"
        if path.is_symlink():
            raise StoreError("Ticket storage contains a symlink. Restore a regular daily file.")
        try:
            raw = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return {"schema_version": 1, "business_date": day, "records": [], "submissions": []}
        try:
            document = json.loads(raw)
            if (type(document["schema_version"]) is not int or document["schema_version"] != 1 or document["business_date"] != day
                    or not isinstance(document["records"], list)
                    or not isinstance(document["submissions"], list)):
                raise ValueError()
            ids, sources = set(), {}
            fields = {"record_id", "business_date", "import_timestamp", "party", "ticket_number",
                      "count", "didWin", "source_image_url", "import_id", "message_id", "saved_at", "entry_source"}
            for record in document["records"]:
                if set(record) != fields:
                    raise ValueError()
                ManualTicket.model_validate({key: record[key] for key in ("party", "ticket_number", "count")})
                rid = record["record_id"]
                if (not re.fullmatch(ID_PATTERN, rid) or rid in ids or record["business_date"] != day
                        or record["didWin"] is not None or record["source_image_url"] is not None):
                    raise ValueError()
                _timestamp(record["import_timestamp"])
                _timestamp(record["saved_at"])
                if record["entry_source"] == "manual":
                    if record["import_id"] is not None or record["message_id"] is not None:
                        raise ValueError()
                    sources[rid] = None
                elif record["entry_source"] == "confirmed_draft":
                    if not all(isinstance(record[k], str) and re.fullmatch(ID_PATTERN, record[k])
                               for k in ("import_id", "message_id")):
                        raise ValueError()
                    sources[rid] = f"{record['import_id']}:{record['message_id']}"
                else:
                    raise ValueError()
                ids.add(rid)
            claimed, keys, confirmed = set(), set(), set()
            for receipt in document["submissions"]:
                if set(receipt) != {"key_hash", "payload_hash", "record_ids", "source"}:
                    raise ValueError()
                if not all(re.fullmatch(r"[0-9a-f]{64}", receipt[k]) for k in ("key_hash", "payload_hash")):
                    raise ValueError()
                refs = receipt["record_ids"]
                if (not isinstance(refs, list) or not refs or len(set(refs)) != len(refs)
                        or not set(refs) <= ids or claimed.intersection(refs)
                        or receipt["key_hash"] in keys):
                    raise ValueError()
                source = receipt["source"]
                if any(sources[rid] != source for rid in refs) or (source is not None and source in confirmed):
                    raise ValueError()
                claimed.update(refs)
                keys.add(receipt["key_hash"])
                if source is not None:
                    confirmed.add(source)
            if claimed != ids:
                raise ValueError()
            return document
        except (ValueError, TypeError, KeyError, AttributeError):
            raise StoreError(f"Ticket storage for {day} is corrupt or has an unsupported schema. Restore it from a backup; no records were overwritten.") from None

    def _write(self, day, document):
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.directory,
                                             prefix=f".{day}-", suffix=".tmp", delete=False) as target:
                temporary = target.name
                json.dump(document, target, ensure_ascii=False, indent=2)
                target.flush()
                os.fsync(target.fileno())
            os.replace(temporary, self.directory / f"{day}.json")
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)

    def list(self, day=None):
        day = validate_date(day if day is not None else business_now().date().isoformat())
        try:
            with self._lock(f"{day}.lock"):
                records = self._read(day)["records"]
            return {"business_date": day, "records": records, "count": len(records)}
        except (OSError, Timeout, UnicodeError):
            raise StoreError("Ticket storage is unavailable or busy. Check storage and retry.") from None

    def save(self, key, payload, *, original=None):
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{1,200}", key):
            raise ValueError("Idempotency-Key must contain 1–200 ASCII letters, digits, dots, underscores, colons or hyphens.")
        request = ConfirmRequest.model_validate(payload) if original is not None else BulkRequest.model_validate(payload)
        canonical = request.model_dump()
        key_hash = _digest(key)
        payload_hash = _digest({"kind": "draft" if original is not None else "manual", **canonical})
        source = None
        if original is not None:
            source = f"{request.import_id}:{request.message_id}"
            if original.get("import_id") != request.import_id:
                raise ValueError("Import identity does not match the source.")
            matches = [draft for draft in original.get("drafts", []) if draft.get("message_id") == request.message_id]
            if (len(matches) != 1 or matches[0].get("source_type") != "text"
                    or matches[0].get("source_image_url") is not None
                    or any(issue.get("message_id") == request.message_id for issue in original.get("issues", []))):
                raise ValueError("Only an existing text draft can be confirmed; issues and image records require separate review.")
            stored = matches[0].get("tickets")
            # Validate stored types too: Python equality alone accepts True == 1.
            if not isinstance(stored, list) or [TicketInput.model_validate(t).model_dump() for t in stored] != canonical["tickets"]:
                raise ConflictError("Draft entries changed or do not match. Reopen the import and review the complete message.")
            day = validate_date(original["business_date"])
            import_timestamp = original["import_timestamp"]
            _timestamp(import_timestamp)
        try:
            with self._lock("catalog.lock"):
                for path in sorted(self.directory.glob("*.json")):
                    try:
                        old_day = validate_date(path.stem)
                    except ValueError:
                        raise StoreError("Ticket storage contains an invalid daily filename. Repair storage before saving.") from None
                    with self._lock(f"{old_day}.lock"):
                        document = self._read(old_day)
                    for receipt in document["submissions"]:
                        if receipt["key_hash"] == key_hash:
                            if receipt["payload_hash"] != payload_hash:
                                raise ConflictError("This idempotency key was already used with a different payload.")
                            by_id = {record["record_id"]: record for record in document["records"]}
                            records = [by_id[rid] for rid in receipt["record_ids"]]
                            return {"records": records, "saved_count": len(records)}
                        if source is not None and receipt["source"] == source:
                            raise ConflictError("This source draft is already confirmed. Refresh its saved state.")
                now = business_now().isoformat()
                if original is None:
                    day, import_timestamp = now[:10], now
                records = [{
                    "record_id": uuid4().hex, "business_date": day,
                    "import_timestamp": import_timestamp,
                    "party": ticket.get("party", canonical.get("party")),
                    "ticket_number": ticket["ticket_number"], "count": ticket["count"],
                    "didWin": None, "source_image_url": None,
                    "import_id": canonical.get("import_id"), "message_id": canonical.get("message_id"),
                    "saved_at": now, "entry_source": "confirmed_draft" if source else "manual",
                } for ticket in canonical["tickets"]]
                with self._lock(f"{day}.lock"):
                    document = self._read(day)
                    document["records"].extend(records)
                    document["submissions"].append({"key_hash": key_hash, "payload_hash": payload_hash,
                                                    "record_ids": [r["record_id"] for r in records], "source": source})
                    self._write(day, document)
                logger.info("Final tickets saved business_date=%s count=%d entry_source=%s", day, len(records), records[0]["entry_source"])
                return {"records": records, "saved_count": len(records)}
        except (OSError, Timeout, UnicodeError):
            raise StoreError("Ticket storage is unavailable or busy. Retry the unchanged batch with the same idempotency key.") from None
