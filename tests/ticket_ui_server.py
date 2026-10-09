"""Isolated browser-test backend. Real ticket API, temporary fixture evidence.

Run only with the dedicated Playwright config; never writes application data.
OCR is not exercised by these final-ticket UI tests.
"""
import json
import os
from pathlib import Path
import sys
import tempfile
import types


def main():
    with tempfile.TemporaryDirectory(prefix="mani-ticket-ui-") as directory:
        os.environ["MANI_DATA_DIR"] = directory
        fake = types.ModuleType("paddleocr")
        fake.PaddleOCR = object
        sys.modules["paddleocr"] = fake
        from tests.test_ticket_store import source_result, IMPORT_ID
        import main as api
        import uvicorn
        source = Path(directory) / "imports" / IMPORT_ID
        source.mkdir(parents=True)
        (source / "result.json").write_text(json.dumps(source_result()), encoding="utf-8")
        uvicorn.run(api.app, host="127.0.0.1", port=8011, access_log=False)


if __name__ == "__main__":
    main()
