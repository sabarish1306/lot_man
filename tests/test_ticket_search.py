"""Final record lookup contract (source extractions are not final records)."""
import json
import tempfile
import unittest
from pathlib import Path
from services.search_service import search_tickets
from services.ticket_store import TicketStore, StoreError


class TicketSearchTests(unittest.TestCase):
    def test_exact_final_only_and_duplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            imports = root / "imports" / ("a" * 32)
            imports.mkdir(parents=True)
            (imports / "result.json").write_text(json.dumps({"drafts": [{"tickets": [{"ticket_number": "999", "count": 1}]}]}))
            store = TicketStore(root / "tickets")
            response = store.save("first", {"tickets": [{"party": "A", "ticket_number": number, "count": 2} for number in ("001234", "1234", "001234", "0012340")]})
            day = response["records"][0]["business_date"]
            result = search_tickets(root / "tickets", day, "001234")
            self.assertEqual(result["match_count"], 2)
            self.assertTrue(all(r["entry_source"] == "manual" for r in result["matches"]))
            self.assertEqual(search_tickets(root / "tickets", day, "999")["match_count"], 0)
            self.assertEqual(search_tickets(root / "missing", day, "999")["match_count"], 0)
            for invalid in ("", "../12", "??", "1.0"):
                with self.assertRaises(ValueError):
                    search_tickets(root / "tickets", day, invalid)
            for invalid in ("2026-02-30", "20261009", "../../today"):
                with self.assertRaises(ValueError):
                    search_tickets(root / "tickets", invalid, "123")
            (root / "tickets" / f"{day}.json").write_text("{")
            with self.assertRaises(StoreError):
                search_tickets(root / "tickets", day, "001234")
