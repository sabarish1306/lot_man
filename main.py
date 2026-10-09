import json
import logging
import re
import zipfile
from contextlib import asynccontextmanager
from datetime import date, datetime
from pathlib import Path
from time import perf_counter
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse

from services.import_service import process_import
from services.search_service import search_tickets
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

IMPORTS_DIR = Path(__file__).resolve().parent / "data" / "imports"
IMPORTS_DIR.mkdir(parents=True, exist_ok=True)

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
        return search_tickets(IMPORTS_DIR, business_date, ticket_number)
    except OSError:
        logger.exception("Ticket lookup could not access saved imports")
        raise HTTPException(503, "Saved imports are unavailable. Check the backend storage and try again.")


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
