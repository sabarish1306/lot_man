import logging
from functools import lru_cache
from pathlib import Path
from threading import Lock

from paddleocr import PaddleOCR

from logging_config import logged_operation

logger = logging.getLogger("mani.ocr")
_lock = Lock()


@lru_cache(maxsize=1)
@logged_operation(logger, "OCR model initialization")
def _get_model():
    # Loads once, on the first OCR call.
    return PaddleOCR(
        device="cpu",
        ocr_version="PP-OCRv5",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )


@logged_operation(logger, "Image OCR")
def extract_image(image_path: str) -> dict:
    path = Path(image_path)

    if not path.is_file():
        logger.warning("Image OCR rejected: file not found")
        raise FileNotFoundError(f"Image not found: {path}")

    regions = []

    logger.debug("Waiting for OCR model lock")
    with _lock:
        logger.debug("OCR model lock acquired")
        model = _get_model()

        for result in model.predict(input=str(path)):
            data = result.json
            data = data.get("res", data)

            for text, score, box in zip(
                data["rec_texts"],
                data["rec_scores"],
                data["rec_boxes"],
            ):
                regions.append({
                    "text": text,
                    "recognition_score": float(score),
                    "box": [int(value) for value in box],
                })

    logger.info("Image OCR extracted regions=%d", len(regions))
    if not regions:
        logger.warning("Image OCR found no text regions")
    return {
        "source_image": str(path),
        "regions": regions,
    }
