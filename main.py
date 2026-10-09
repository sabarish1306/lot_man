import json
import logging
import os
import re
import zipfile
from contextlib import asynccontextmanager
from datetime import date, datetime
from pathlib import Path
from time import perf_counter
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from services.import_service import process_import
from services.search_service import search_tickets
from services.ticket_store import BulkRequest, ConfirmRequest, ConflictError, StoreError, TicketStore
from logging_config import configure_logging, request_id

configure_logging()
logger = logging.getLogger("mani.api")


@asynccontextmanager
async def lifespan(app):
    logger.info("Application started max_upload_bytes=%d", MAX_UPLOAD_BYTES)
    try:
        yield
    finally:
        logger.info("Application stopped")


app = FastAPI(title="WhatsApp Ticket Import", lifespan=lifespan)

DATA_DIR = Path(os.environ.get("MANI_DATA_DIR", Path(__file__).resolve().parent / "data"))
IMPORTS_DIR = DATA_DIR / "imports"
IMPORTS_DIR.mkdir(parents=True, exist_ok=True)

TICKETS_DIR = DATA_DIR / "tickets"

MAX_UPLOAD_BYTES = 100 * 1024 * 1024


@app.middleware("http")
async def log_request(request: Request, call_next):
    correlation_id = uuid4().hex
    token = request_id.set(correlation_id)
    started = perf_counter()
    status = 500
    logger.info("Request started method=%s", request.method)
    try:
        response = await call_next(request)
        status = response.status_code
        response.headers["X-Request-ID"] = correlation_id
        return response
    except Exception:
        logger.exception("Unhandled request failure")
        raise
    finally:
        route = request.scope.get("route")
        logger.log(
            logging.ERROR if status >= 500 else logging.WARNING if status >= 400 else logging.INFO,
            "Request completed method=%s route=%s status=%d duration_ms=%.1f",
            request.method, getattr(route, "path", "<unmatched>"), status,
            (perf_counter() - started) * 1000,
        )
        request_id.reset(token)


def get_import_dir(import_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}", import_id):
        logger.warning("Import lookup rejected: invalid ID format")
        raise HTTPException(404, "Import not found.")

    directory = IMPORTS_DIR / import_id

    if not directory.is_dir():
        logger.warning("Import not found import_id=%s", import_id)
        raise HTTPException(404, "Import not found.")

    return directory


def load_result(import_id: str) -> dict:
    path = get_import_dir(import_id) / "result.json"

    if not path.is_file():
        logger.warning("Result not found import_id=%s", import_id)
        raise HTTPException(404, "Processing result not found.")

    result = json.loads(path.read_text(encoding="utf-8"))
    logger.debug("Result loaded import_id=%s", import_id)
    return result


@app.post("/imports", status_code=201)
def upload_whatsapp_zip(
    file: UploadFile = File(...),
    party: str | None = Form(None),
):
    import_id = uuid4().hex
    logger.info("Upload started import_id=%s", import_id)
    directory = IMPORTS_DIR / import_id
    directory.mkdir()

    now = datetime.now(ZoneInfo("Asia/Kolkata"))

    metadata = {
        "import_id": import_id,
        "party": (party or "").strip() or None,
        "import_timestamp": now.isoformat(),
        "business_date": now.date().isoformat(),
    }

    (directory / "metadata.json").write_text(
        json.dumps(metadata, indent=2),
        encoding="utf-8",
    )

    try:
        total = 0

        with (directory / "source.zip").open("wb") as destination:
            while chunk := file.file.read(1024 * 1024):
                total += len(chunk)

                if total > MAX_UPLOAD_BYTES:
                    logger.warning("Upload limit exceeded import_id=%s bytes=%d", import_id, total)
                    raise HTTPException(413, "Upload exceeds 100 MB.")

                destination.write(chunk)

        logger.info("Upload saved import_id=%s bytes=%d", import_id, total)
        return process_import(directory, metadata)

    except HTTPException:
        raise
    except (ValueError, zipfile.BadZipFile, UnicodeError) as exc:
        logger.warning("Import rejected import_id=%s error_type=%s", import_id, type(exc).__name__)
        (directory / "error.json").write_text(
            json.dumps({"error": str(exc)}),
            encoding="utf-8",
        )
        raise HTTPException(
            400,
            detail={"import_id": import_id, "error": str(exc)},
        )
    except Exception:
        logger.exception("Import processing failed import_id=%s", import_id)
        raise HTTPException(
            500,
            detail={
                "import_id": import_id,
                "error": "Import processing failed. Check the server terminal.",
            },
        )
    finally:
        file.file.close()
        logger.debug("Upload stream closed import_id=%s", import_id)


@app.get("/imports/{import_id}")
def get_import_result(import_id: str):
    return load_result(import_id)


@app.get("/tickets/search")
def search_saved_tickets(
    business_date: str = Query(..., pattern=r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"),
    ticket_number: str = Query(..., pattern=r"^[0-9]+$"),
):
    try:
        date.fromisoformat(business_date)
    except ValueError:
        raise HTTPException(422, "Enter a valid business date in YYYY-MM-DD format.")
    try:
        return search_tickets(TICKETS_DIR, business_date, ticket_number)
    except ValueError:
        raise HTTPException(422, "Enter a valid business date and ASCII ticket number.")


@app.get("/imports/{import_id}/issues")
def get_import_issues(import_id: str):
    result = load_result(import_id)
    logger.debug("Issues loaded import_id=%s count=%d", import_id, len(result["issues"]))

    return {
        "import_id": import_id,
        "issues": result["issues"],
    }


@app.get("/imports/{import_id}/images/{filename}")
def get_source_image(import_id: str, filename: str):
    directory = get_import_dir(import_id)

    if not re.fullmatch(
        r"[0-9a-f]{32}\.(jpg|jpeg|png|webp)", filename
    ):
        logger.warning("Image lookup rejected: invalid filename import_id=%s", import_id)
        raise HTTPException(404, "Image not found.")

    path = directory / "media" / filename

    if not path.is_file():
        logger.warning("Image not found import_id=%s image_id=%s", import_id, filename)
        raise HTTPException(404, "Image not found.")

    logger.debug("Serving image import_id=%s image_id=%s", import_id, filename)
    return FileResponse(path)


@app.exception_handler(StoreError)
async def storage_error(request: Request, exc: StoreError):
    logger.error("Final ticket storage unavailable")
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(ConflictError)
async def ticket_conflict(request: Request, exc: ConflictError):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.get("/tickets")
def list_final_tickets(business_date: str | None = Query(None)):
    try:
        return TicketStore(TICKETS_DIR).list(business_date)
    except ValueError:
        raise HTTPException(422, "Enter a valid business date in YYYY-MM-DD format.")


@app.post("/tickets/bulk")
def save_manual_tickets(payload: BulkRequest, idempotency_key: str = Header(...)):
    try:
        return TicketStore(TICKETS_DIR).save(idempotency_key, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@app.post("/tickets/confirm-draft")
def confirm_text_draft(payload: ConfirmRequest, idempotency_key: str = Header(...)):
    try:
        original = load_result(payload.import_id)
    except (OSError, ValueError, UnicodeError):
        raise StoreError("The original import result is unreadable. Restore it before confirming.") from None
    try:
        return TicketStore(TICKETS_DIR).save(idempotency_key, payload.model_dump(), original=original)
    except (ValueError, KeyError, TypeError, AttributeError):
        raise HTTPException(422, "The source must be a valid existing text draft with unchanged entries and valid import metadata.")
