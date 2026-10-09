import copy
import io
import json
import multiprocessing
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile

from services.ticket_store import TicketStore, StoreError, ConflictError, IST

PAYLOAD = {"tickets": [{"party": " Mani ", "ticket_number": "001234", "count": 5}]}
IMPORT_ID = "a" * 32
MESSAGE_ID = "b" * 32


def source_result():
    return {"import_id": IMPORT_ID, "business_date": "2026-10-08",
            "import_timestamp": "2026-10-08T23:59:00+05:30", "party": None,
            "status": "processed_with_review", "message_count": 1, "image_count": 0,
            "accepted_ticket_count": 0, "issues": [], "drafts": [{
                "message_id": MESSAGE_ID, "source_type": "text", "source_image_url": None,
                "text": "001234-5\n001234-5", "status": "draft_unvalidated",
                "tickets": [{"ticket_number": "001234", "count": 5}] * 2}]}


def confirm_payload():
    return {"import_id": IMPORT_ID, "message_id": MESSAGE_ID, "party": "Mani",
            "tickets": source_result()["drafts"][0]["tickets"]}


def concurrent_save(arguments):
    directory, key = arguments
    return TicketStore(Path(directory)).save(key, PAYLOAD)["records"][0]["record_id"]


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = TicketStore(self.root / "tickets")

    def test_leading_zeros_duplicates_and_backend_metadata(self):
        result = self.store.save("one", {"tickets": PAYLOAD["tickets"] * 2})
        self.assertEqual(result["saved_count"], 2)
        records = result["records"]
        self.assertNotEqual(records[0]["record_id"], records[1]["record_id"])
        for record in records:
            self.assertEqual(record["ticket_number"], "001234")
            self.assertEqual(record["party"], "Mani")
            self.assertEqual(record["entry_source"], "manual")
            self.assertIsNone(record["didWin"])
            self.assertIsNone(record["import_id"])
            self.assertIsNone(record["message_id"])
            self.assertIsNone(record["source_image_url"])
            self.assertTrue(record["saved_at"].endswith("+05:30"))
        self.store.save("two", PAYLOAD)
        self.assertEqual(self.store.list()["count"], 3)

    def test_whole_batch_validation_no_partial_write(self):
        first = self.store.save("original", PAYLOAD)
        path = self.store.directory / f"{first['records'][0]['business_date']}.json"
        before = path.read_bytes()
        bad_rows = [{"count": value} for value in (0, -1, True, 1.0, 1.5, "5")] + [
            {"party": "  "}, {"ticket_number": ""}, {"ticket_number": "१२३"},
            {"ticket_number": 123}, {"ticket_number": "1\n"}, {"ticket_number": "../12"}]
        for bad in bad_rows:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.store.save("bad", {"tickets": [PAYLOAD["tickets"][0], {**PAYLOAD["tickets"][0], **bad}]})
            self.assertEqual(path.read_bytes(), before)
        with self.assertRaises(ValueError):
            self.store.save("empty", {"tickets": []})

    def test_idempotency_conflict_and_midnight(self):
        with patch("services.ticket_store.business_now", return_value=datetime(2026, 10, 9, 23, 59, tzinfo=IST)):
            first = self.store.save("one", PAYLOAD)
        with patch("services.ticket_store.business_now", return_value=datetime(2026, 10, 10, 0, 1, tzinfo=IST)):
            self.assertEqual(self.store.save("one", PAYLOAD), first)
            self.assertEqual(self.store.list()["count"], 0)
            self.assertFalse((self.store.directory / "2026-10-10.json").exists())
            with self.assertRaises(ConflictError):
                self.store.save("one", {"tickets": [{**PAYLOAD["tickets"][0], "count": 9}]})
        self.assertEqual(self.store.list("2026-10-09")["count"], 1)

    def test_process_concurrency_and_same_key_race(self):
        with ProcessPoolExecutor(max_workers=4, mp_context=multiprocessing.get_context("spawn")) as pool:
            ids = list(pool.map(concurrent_save, [(str(self.store.directory), f"key-{i}") for i in range(12)]))
            repeats = list(pool.map(concurrent_save, [(str(self.store.directory), "shared")] * 8))
        self.assertEqual(len(set(ids)), 12)
        self.assertEqual(len(set(repeats)), 1)
        self.assertEqual(self.store.list()["count"], 13)

    def test_corrupt_storage_is_never_overwritten(self):
        first = self.store.save("one", PAYLOAD)
        path = self.store.directory / f"{first['records'][0]['business_date']}.json"
        for corrupt in ("{", "[]", '{"schema_version": 99}', '{"schema_version":1,"records":[]}'):
            path.write_text(corrupt)
            with self.assertRaises(StoreError):
                self.store.list()
            with self.assertRaises(StoreError):
                self.store.save("two", PAYLOAD)
            self.assertEqual(path.read_text(), corrupt)

    def test_failed_atomic_replace_keeps_old_records_and_receipts(self):
        first = self.store.save("one", PAYLOAD)
        path = self.store.directory / f"{first['records'][0]['business_date']}.json"
        before = path.read_bytes()
        with patch("services.ticket_store.os.replace", side_effect=OSError("test")), self.assertRaises(StoreError):
            self.store.save("two", PAYLOAD)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(list(self.store.directory.glob("*.tmp")), [])
        self.store.save("two", PAYLOAD)
        self.assertEqual(self.store.list()["count"], 2)

    def test_draft_confirmation_is_atomic_exact_and_source_protected(self):
        original = source_result()
        unchanged = copy.deepcopy(original)
        payload = confirm_payload()
        result = self.store.save("confirm", payload, original=original)
        self.assertEqual(result["saved_count"], 2)
        self.assertEqual(self.store.save("confirm", payload, original=original), result)
        with self.assertRaises(ConflictError):
            self.store.save("different-key", payload, original=original)
        for record in result["records"]:
            self.assertEqual(record["business_date"], original["business_date"])
            self.assertEqual(record["import_timestamp"], original["import_timestamp"])
            self.assertEqual(record["entry_source"], "confirmed_draft")
        self.assertEqual(original, unchanged)

    def test_stale_reordered_partial_image_and_issue_rejected(self):
        original = source_result()
        original["drafts"][0]["tickets"][1] = {"ticket_number": "002", "count": 1}
        for tickets in (original["drafts"][0]["tickets"][:1], list(reversed(original["drafts"][0]["tickets"]))):
            with self.assertRaises(ConflictError):
                self.store.save("key", {**confirm_payload(), "tickets": tickets}, original=original)
        for kind in ("image", "issue", "missing"):
            source = source_result()
            if kind == "image":
                source["drafts"][0]["source_type"] = "image"
            elif kind == "issue":
                source["issues"] = source.pop("drafts")
            else:
                source["drafts"] = []
            with self.assertRaises(ValueError):
                self.store.save("key", confirm_payload(), original=source)
        self.assertFalse(self.store.directory.exists())

    def test_dates_identifiers_and_keys(self):
        for day in ("../../x", "20261009", "2026-02-30"):
            with self.assertRaises(ValueError):
                self.store.list(day)
        for key in ("", "../x", "x" * 201, "a\nb"):
            with self.assertRaises(ValueError):
                self.store.save(key, PAYLOAD)
        with self.assertRaises(ValueError):
            self.store.save("key", {**confirm_payload(), "import_id": "../x"}, original=source_result())


class ApiTests(unittest.TestCase):
    # Reuse temporary directories only; model boundaries are replaced in tests.
    @classmethod
    def setUpClass(cls):
        fake = types.ModuleType("paddleocr")
        fake.PaddleOCR = object
        previous = sys.modules.get("paddleocr")
        sys.modules["paddleocr"] = fake
        try:
            import main
        finally:
            if previous is None:
                sys.modules.pop("paddleocr", None)
            else:
                sys.modules["paddleocr"] = previous
        cls.main = main

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = TicketStore(self.root / "tickets")
        from fastapi.testclient import TestClient
        self.imports = self.root / "imports"
        self.imports.mkdir()
        self.enterContext(patch.object(self.main, "IMPORTS_DIR", self.imports))
        self.enterContext(patch.object(self.main, "TICKETS_DIR", self.store.directory))
        self.client = self.enterContext(TestClient(self.main.app))

    def test_http_save_validation_replay_and_search(self):
        client = self.client
        self.assertEqual(client.post("/tickets/bulk", json=PAYLOAD).status_code, 422)
        for count in (True, 1.2, 1.0, "1", 0):
            response = client.post("/tickets/bulk", headers={"Idempotency-Key": "bad"}, json={"tickets": [PAYLOAD["tickets"][0], {**PAYLOAD["tickets"][0], "count": count}]})
            self.assertEqual(response.status_code, 422)
        self.assertEqual(client.get("/tickets").json()["count"], 0)
        first = client.post("/tickets/bulk", json=PAYLOAD, headers={"Idempotency-Key": "save"})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(client.post("/tickets/bulk", json=PAYLOAD, headers={"Idempotency-Key": "save"}).json(), first.json())
        self.assertEqual(client.post("/tickets/bulk", json={"tickets": PAYLOAD["tickets"] * 2}, headers={"Idempotency-Key": "save"}).status_code, 409)
        day = first.json()["records"][0]["business_date"]
        self.assertEqual(client.get("/tickets/search", params={"business_date": day, "ticket_number": "001234"}).json()["match_count"], 1)
        self.assertEqual(client.get("/tickets/search", params={"business_date": day, "ticket_number": "1234"}).json()["match_count"], 0)
        self.assertEqual(client.get("/tickets", params={"business_date": "../x"}).status_code, 422)
        (self.store.directory / f"{day}.json").write_text("{")
        self.assertEqual(client.get("/tickets").status_code, 503)
        self.assertEqual(client.post("/tickets/bulk", json=PAYLOAD, headers={"Idempotency-Key": "next"}).status_code, 503)

    def test_confirm_and_original_import_routes_unchanged(self):
        directory = self.imports / IMPORT_ID
        directory.mkdir()
        path = directory / "result.json"
        path.write_text(json.dumps(source_result()), encoding="utf-8")
        before = path.read_bytes()
        self.assertEqual(self.client.get(f"/imports/{IMPORT_ID}").json(), source_result())
        self.assertEqual(self.client.get(f"/imports/{IMPORT_ID}/issues").json(), {"import_id": IMPORT_ID, "issues": []})
        response = self.client.post("/tickets/confirm-draft", json=confirm_payload(), headers={"Idempotency-Key": "confirm"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.post("/tickets/confirm-draft", json=confirm_payload(), headers={"Idempotency-Key": "other"}).status_code, 409)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(self.client.get("/tickets", params={"business_date": "2026-10-08"}).json()["count"], 2)
        media = directory / "media"
        media.mkdir()
        image = media / (("c" * 32) + ".png")
        image.write_bytes(b"test image bytes")
        self.assertEqual(self.client.get(f"/imports/{IMPORT_ID}/images/{image.name}").content, image.read_bytes())
        self.assertEqual(self.client.post(f"/imports/{IMPORT_ID}/issues/resolve").status_code, 404)

    def test_real_zip_pipeline_keeps_optional_party_drafts_and_images(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as zip_file:
            zip_file.writestr("chat.txt", "09/10/2026, 10:00 - Sender: 001234-5\n09/10/2026, 10:01 - Sender: sample.png (file attached)")
            zip_file.writestr("sample.png", b"test image")
        extraction = {"tickets": [{"ticket_number": "001234", "count": 5}], "needs_review": False, "review_reason": None}
        with patch("services.import_service.extract_tickets", return_value=extraction), patch("services.import_service.extract_image", return_value={"regions": []}):
            response = self.client.post("/imports", files={"file": ("test.zip", archive.getvalue(), "application/zip")})
        self.assertEqual(response.status_code, 201, response.text)
        report = response.json()
        self.assertIsNone(report["party"])
        self.assertEqual(len(report["drafts"]), 1)
        self.assertEqual(report["issues"][0]["source_type"], "image")
        self.assertEqual(report["accepted_ticket_count"], 0)
        self.assertEqual(self.client.get("/tickets").json()["count"], 0)
        self.assertEqual(self.client.get(f"/imports/{report['import_id']}").json(), report)
