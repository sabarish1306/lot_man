import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from services.search_service import search_tickets


class SearchFixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def save(self, number, day="2026-10-09", tickets=None, issues=None):
        import_id = f"{number:032x}"
        directory = self.root / import_id
        directory.mkdir()
        record = {
            "message_id": "source-message", "sender": "Source sender",
            "message_timestamp_raw": "01/02/25 10:30", "text": "original message",
            "source_type": "text", "party": None, "source_image_url": None,
            "tickets": tickets if tickets is not None else [{"ticket_number": "001234", "count": 5}],
            "status": "draft_unvalidated", "custom_field": {"preserved": True},
        }
        result = {
            "import_id": import_id, "business_date": day,
            "import_timestamp": f"{day}T10:00:00+05:30", "party": None,
            "status": "processed_with_review", "drafts": [record],
            "issues": issues or [], "accepted_ticket_count": 0,
        }
        (directory / "result.json").write_text(json.dumps(result), encoding="utf-8")
        return result


class TicketSearchTests(SearchFixture):
    def test_all_imports_exact_number_duplicates_and_complete_record(self):
        tickets = [{"ticket_number": "001234", "count": 5},
                   {"ticket_number": "1234", "count": 9},
                   {"ticket_number": "001234", "count": 2},
                   {"ticket_number": "0012340", "count": 7}]
        first = self.save(1, tickets=tickets)
        second = self.save(2)
        self.save(3, day="2026-10-08")
        response = search_tickets(self.root, "2026-10-09", "001234")
        self.assertEqual(response["match_count"], 3)
        self.assertEqual(response["matched_import_count"], 2)
        self.assertEqual(response["searched_import_count"], 2)
        self.assertEqual([match["ticket"]["count"] for match in response["matches"]], [5, 2, 5])
        self.assertEqual(response["matches"][0]["record"], first["drafts"][0])
        self.assertEqual(response["matches"][1]["ticket_index"], 2)
        self.assertEqual(response["matches"][2]["import_id"], second["import_id"])
        self.assertEqual(response["matches"][0]["record"]["message_timestamp_raw"], "01/02/25 10:30")
        self.assertEqual(json.loads((self.root / first["import_id"] / "result.json").read_text()), first)

    def test_review_suggestions_remain_review_records(self):
        issue = {"issue_id": "issue", "source_type": "image", "reason": "Review image",
                 "details": {"ocr": {"regions": []}, "extraction": {"tickets": [{"ticket_number": "001234", "count": 4}]}}}
        self.save(1, tickets=[], issues=[issue])
        response = search_tickets(self.root, "2026-10-09", "001234")
        self.assertEqual(response["match_count"], 1)
        self.assertEqual(response["matches"][0]["record_type"], "review")
        self.assertEqual(response["matches"][0]["record"], issue)
        self.assertNotIn("status", response["matches"][0]["record"])

    def test_raw_text_is_not_a_ticket_and_absent_issue_fields_are_safe(self):
        self.save(1, tickets=[], issues=[{"text": "001234", "source_type": "text"}, {"details": {"error": "failed"}}])
        self.assertEqual(search_tickets(self.root, "2026-10-09", "001234")["match_count"], 0)

    def test_unfinished_uploads_are_skipped(self):
        (self.root / ("f" * 32)).mkdir()
        self.assertEqual(search_tickets(self.root, "2026-10-09", "001234")["searched_import_count"], 0)

    def test_corrupt_result_warns_without_hiding_other_matches(self):
        first = self.save(1)
        self.save(2)
        (self.root / first["import_id"] / "result.json").write_text("{", encoding="utf-8")
        response = search_tickets(self.root, "2026-10-09", "001234")
        self.assertEqual(response["match_count"], 1)
        self.assertEqual(len(response["warnings"]), 1)

    def test_malformed_ticket_does_not_return_partial_import(self):
        self.save(1, tickets=[{"ticket_number": "001234", "count": 2}, {"ticket_number": 1234, "count": 1}])
        response = search_tickets(self.root, "2026-10-09", "001234")
        self.assertEqual(response["matches"], [])
        self.assertEqual(len(response["warnings"]), 1)

    def test_empty_date_and_leading_zero_distinction(self):
        self.save(1)
        self.assertEqual(search_tickets(self.root, "2026-10-09", "1234")["match_count"], 0)
        self.assertEqual(search_tickets(self.root, "2026-10-10", "001234")["searched_import_count"], 0)

    def test_invalid_input(self):
        for day, number in [("2026-02-30", "123"), ("20261009", "123"), ("2026-10-09", "../123"), ("2026-10-09", "")]:
            with self.subTest(day=day, number=number), self.assertRaises(ValueError):
                search_tickets(self.root, day, number)


class SearchApiTests(SearchFixture):
    @classmethod
    def setUpClass(cls):
        # API tests use real routes/storage; OCR is not involved in lookup.
        import types
        import sys
        fake = types.ModuleType("paddleocr")
        fake.PaddleOCR = object
        with patch.dict(sys.modules, {"paddleocr": fake}):
            import main
        cls.main = main

    def test_http_validation_and_complete_response(self):
        from fastapi.testclient import TestClient
        self.save(1)
        with patch.object(self.main, "IMPORTS_DIR", self.root), TestClient(self.main.app) as client:
            response = client.get("/tickets/search", params={"business_date": "2026-10-09", "ticket_number": "001234"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["matches"][0]["ticket"]["ticket_number"], "001234")
            for params in [{}, {"business_date": "2026-02-30", "ticket_number": "123"}, {"business_date": "2026-10-09", "ticket_number": "1.2"}]:
                self.assertEqual(client.get("/tickets/search", params=params).status_code, 422)

    def test_unavailable_storage_is_not_an_empty_search(self):
        from fastapi.testclient import TestClient
        with patch.object(self.main, "IMPORTS_DIR", self.root / "missing"), TestClient(self.main.app) as client:
            response = client.get("/tickets/search", params={"business_date": "2026-10-09", "ticket_number": "001234"})
            self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
