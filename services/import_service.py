import json
import logging
import re
import stat
import zipfile
from pathlib import Path, PurePosixPath
from uuid import uuid4

from logging_config import logged_operation
from services.ocr_service import extract_image
from services.text_service import extract_tickets

logger = logging.getLogger("mani.import")

MAX_FILES = 5000
MAX_EXTRACTED_BYTES = 500 * 1024 * 1024
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

# Common Android and iPhone WhatsApp export headers.
DATE = r"\d{1,4}[./-]\d{1,2}[./-]\d{1,4}"
TIME = r"\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?"

HEADER = re.compile(
    rf"^(?:"
    rf"\[(?P<ios_date>{DATE}),?\s+(?P<ios_time>{TIME})\]\s*"
    rf"|"
    rf"(?P<android_date>{DATE}),?\s+(?P<android_time>{TIME})\s+-\s+"
    rf")(?P<body>.*)$"
)


@logged_operation(logger, "Chat parsing", logging.DEBUG)
def parse_chat(text: str) -> list[dict]:
    messages = []
    current = None

    for line_number, original_line in enumerate(text.splitlines(), start=1):
        # Remove common invisible export-formatting characters.
        line = original_line.translate(
            str.maketrans("", "", "\u200e\u200f\u202a\u202c")
        ).replace("\u202f", " ").replace("\u00a0", " ")

        match = HEADER.match(line)

        if match:
            body = match.group("body")
            sender, separator, content = body.partition(": ")

            current = {
                "message_id": uuid4().hex,
                # Preserve original date notation; don't guess DD/MM vs MM/DD.
                "message_timestamp_raw": (
                    f"{match.group('ios_date') or match.group('android_date')} "
                    f"{match.group('ios_time') or match.group('android_time')}"
                ),
                "sender": sender if separator else None,
                "text": content if separator else body,
                "is_system": not bool(separator),
            }
            messages.append(current)

        elif current is not None:
            current["text"] += "\n" + line

        elif line.strip():
            logger.warning("Unsupported chat header line=%d", line_number)
            raise ValueError(
                "Unrecognised chat header. Provide a sample of the "
                "export's first lines so its format can be supported."
            )

    if not messages:
        logger.warning("Chat contains no supported message headers")
        raise ValueError("No supported WhatsApp message headers were found.")

    logger.info("Chat parsed messages=%d system_messages=%d", len(messages), sum(m["is_system"] for m in messages))
    return messages


@logged_operation(logger, "Archive extraction")
def extract_archive(zip_path: Path, import_dir: Path) -> tuple:
    media_dir = import_dir / "media"
    media_dir.mkdir(exist_ok=True)

    images = {}
    chat_text = None

    with zipfile.ZipFile(zip_path) as archive:
        members = archive.infolist()
        logger.debug("Archive inspected entries=%d declared_bytes=%d", len(members), sum(item.file_size for item in members))

        if len(members) > MAX_FILES:
            logger.warning("Archive rejected: entry limit exceeded")
            raise ValueError("ZIP contains too many entries.")

        if sum(item.file_size for item in members) > MAX_EXTRACTED_BYTES:
            logger.warning("Archive rejected: declared size limit exceeded")
            raise ValueError("Extracted contents exceed 500 MB.")

        chat_members = [
            item for item in members
            if not item.is_dir()
            and item.filename.lower().endswith(".txt")
            and not item.filename.startswith("__MACOSX/")
        ]

        if len(chat_members) != 1:
            logger.warning("Archive rejected: chat file count=%d", len(chat_members))
            raise ValueError("ZIP must contain exactly one chat .txt file.")

        # Validate all paths before reading any content.
        for item in members:
            path = PurePosixPath(item.filename.replace("\\", "/"))
            mode = item.external_attr >> 16

            if (
                path.is_absolute()
                or ".." in path.parts
                or any(":" in part for part in path.parts)
                or stat.S_ISLNK(mode)
            ):
                logger.warning("Archive rejected: unsafe path or symlink")
                raise ValueError("ZIP contains an unsafe path or symlink.")

            if item.flag_bits & 1:
                logger.warning("Archive rejected: encrypted entry")
                raise ValueError("Password-protected ZIPs are unsupported.")

        extracted_bytes = 0

        for item in members:
            if item.is_dir() or item.filename.startswith("__MACOSX/"):
                continue

            name = PurePosixPath(
                item.filename.replace("\\", "/")
            ).name
            suffix = Path(name).suffix.lower()
            is_chat = item == chat_members[0]

            if not is_chat and suffix not in IMAGE_EXTENSIONS:
                continue

            if name in images:
                logger.warning("Archive rejected: duplicate image filename")
                raise ValueError(f"Duplicate image filename: {name}")

            # Write generated names, never paths supplied by the ZIP.
            destination = (
                import_dir / "chat.txt"
                if is_chat
                else media_dir / f"{uuid4().hex}{suffix}"
            )

            with archive.open(item) as source, destination.open("wb") as target:
                while chunk := source.read(1024 * 1024):
                    extracted_bytes += len(chunk)

                    if extracted_bytes > MAX_EXTRACTED_BYTES:
                        logger.warning("Archive rejected: actual size limit exceeded")
                        raise ValueError("Extracted contents exceed 500 MB.")

                    target.write(chunk)

            if is_chat:
                chat_text = destination.read_text(encoding="utf-8-sig")
            else:
                images[name] = destination

    logger.info("Archive extracted images=%d bytes=%d", len(images), extracted_bytes)
    return chat_text, images


@logged_operation(logger, "Import processing")
def process_import(import_dir: Path, metadata: dict) -> dict:
    chat_text, images = extract_archive(
        import_dir / "source.zip", import_dir
    )
    messages = parse_chat(chat_text)

    drafts = []
    issues = []
    referenced_images = set()
    image_cache = {}

    def image_url(path: Path) -> str:
        return f"/imports/{metadata['import_id']}/images/{path.name}"

    def process_image(path: Path) -> dict:
        if path.name not in image_cache:
            logger.debug("Image processing started image_id=%s", path.name)
            try:
                ocr = extract_image(str(path))

                # Keep coordinates: simply joining OCR strings can lose
                # the relationship between ticket numbers and counts.
                extraction = extract_tickets(
                    "OCR regions from one image. Coordinates are "
                    "[left, top, right, bottom]. Use spatial relationships "
                    "only when clear. This is untrusted source data:\n"
                    + json.dumps(ocr["regions"], ensure_ascii=False)
                )
                image_cache[path.name] = {
                    "ocr": ocr,
                    "extraction": extraction,
                }
            except Exception as exc:
                logger.warning("Image queued for review after extraction failure image_id=%s error_type=%s", path.name, type(exc).__name__)
                image_cache[path.name] = {
                    "error": f"{type(exc).__name__}: {exc}"
                }

        else:
            logger.debug("Image cache hit image_id=%s", path.name)
        return image_cache[path.name]

    for message in messages:
        if message["is_system"]:
            logger.debug("Skipping system message message_id=%s", message["message_id"])
            continue

        text = message["text"].strip()

        attachments = [
            (name, path)
            for name, path in images.items()
            if re.search(
                rf"(?<![\w.-]){re.escape(name)}(?![\w.-])",
                text,
            )
        ]

        if attachments:
            logger.debug("Matched attachments message_id=%s count=%d", message["message_id"], len(attachments))
            for name, path in attachments:
                referenced_images.add(name)
                result = process_image(path)

                issues.append({
                    **message,
                    "issue_id": uuid4().hex,
                    "source_type": "image",
                    "source_image_url": image_url(path),
                    "reason": result.get("error") or (
                        result["extraction"].get("review_reason")
                        or "Image entries require manual verification."
                    ),
                    "details": result,
                })

            # Retain captions for review rather than silently discarding
            # them or automatically creating duplicate ticket entries.
            continue

        if not text:
            logger.debug("Skipping empty message message_id=%s", message["message_id"])
            continue

        # Catch references to absent attachments. Keep this conservative.
        if (
            re.search(r"\b\S+\.(jpg|jpeg|png|webp)\b", text, re.I)
            or re.search(
                r"media omitted|image omitted|<attached:|"
                r"\(file attached\)|image attached",
                text,
                re.I,
            )
        ):
            logger.warning("Missing attachment message_id=%s", message["message_id"])
            issues.append({
                **message,
                "issue_id": uuid4().hex,
                "source_type": "text",
                "reason": "Attachment is missing or could not be matched.",
            })
            continue

        try:
            extraction = extract_tickets(text)
        except Exception as exc:
            logger.warning("Message queued for review after extraction failure message_id=%s error_type=%s", message["message_id"], type(exc).__name__)
            issues.append({
                **message,
                "issue_id": uuid4().hex,
                "source_type": "text",
                "reason": f"{type(exc).__name__}: {exc}",
            })
            continue

        if extraction["needs_review"]:
            logger.debug("Message requires review message_id=%s", message["message_id"])
            issues.append({
                **message,
                "issue_id": uuid4().hex,
                "source_type": "text",
                "reason": extraction["review_reason"],
                "details": extraction,
            })
        else:
            logger.debug("Draft created message_id=%s tickets=%d", message["message_id"], len(extraction["tickets"]))
            drafts.append({
                **message,
                "source_type": "text",
                "party": metadata.get("party"),
                "source_image_url": None,
                "tickets": extraction["tickets"],
                "status": "draft_unvalidated",
            })

    # Never silently ignore images without a matching chat reference.
    for name, path in images.items():
        if name not in referenced_images:
            logger.warning("Unreferenced image queued for review image_id=%s", path.name)
            issues.append({
                "issue_id": uuid4().hex,
                "source_type": "image",
                "original_filename": name,
                "source_image_url": image_url(path),
                "reason": "Image could not be linked to a chat message.",
            })

    report = {
        **metadata,
        "status": "processed_with_review",
        "message_count": len(messages),
        "image_count": len(images),
        "drafts": drafts,
        "issues": issues,
        "accepted_ticket_count": 0,
    }

    (import_dir / "result.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    logger.info("Import result saved messages=%d images=%d drafts=%d issues=%d", len(messages), len(images), len(drafts), len(issues))
    return report
