"""Manual OCR smoke check: python -m tests.test_ocr."""

import json
from pathlib import Path


def main():
    # Keep heavy OCR imports out of automated test discovery.
    from logging_config import configure_logging
    from services.ocr_service import extract_image

    configure_logging()
    project_root = Path(__file__).resolve().parents[1]

    # Change to sample.png if that is your image's filename.
    result = extract_image(str(project_root / "sample.jpg"))
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
