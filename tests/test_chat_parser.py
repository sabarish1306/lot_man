"""Chat-format regression checks without OCR/model initialization."""
import sys
import types
import unittest


NOTICE = (
    "Messages and calls are end-to-end encrypted. No one outside of this "
    "chat, not even WhatsApp, can read or listen to them."
)


class ChatParserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Only replace the heavy OCR dependency while importing the parser.
        # Keep the imported service module cached for the API regression tests.
        previous = sys.modules.get("paddleocr")
        fake = types.ModuleType("paddleocr")
        fake.PaddleOCR = object
        sys.modules["paddleocr"] = fake
        try:
            from services.import_service import parse_chat
        finally:
            if previous is None:
                sys.modules.pop("paddleocr", None)
            else:
                sys.modules["paddleocr"] = previous
        cls.parse = staticmethod(parse_chat)

    def test_opening_notice_before_bracketed_export(self):
        text = (
            NOTICE + "\n"
            f"[10/9/26, 2:28:38 AM] - {NOTICE} Tap to learn more.\n"
            "[10/9/26, 2:28:38 AM] - You created the group\n"
            "[10/9/26, 2:30:02 AM] You: Party: Example\n"
            "001234-5,\n007890*2\n001234-5"
        )
        messages = self.parse(text)
        self.assertEqual(len(messages), 3)
        self.assertTrue(all(message["is_system"] for message in messages[:2]))
        self.assertFalse(messages[2]["is_system"])
        self.assertEqual(messages[2]["sender"], "You")
        self.assertEqual(messages[2]["message_timestamp_raw"], "10/9/26 2:30:02 AM")
        self.assertEqual(messages[2]["text"], "Party: Example\n001234-5,\n007890*2\n001234-5")

    def test_known_variants_and_android_headers(self):
        for notice in (NOTICE, NOTICE + " Tap to learn more.",
                       "\ufeff\u200e" + NOTICE.replace(" ", "\u00a0") + "  "):
            with self.subTest(notice_variant=notice[-20:]):
                messages = self.parse("\n" + notice + "\n\n09/10/2026, 10:00 - Sender: 001234-5")
                self.assertEqual(len(messages), 1)
                self.assertEqual(messages[0]["sender"], "Sender")
                self.assertEqual(messages[0]["text"], "001234-5")

    def test_unknown_preamble_and_notice_prefix_are_rejected(self):
        for preamble in ("Unsupported header", "001234-5", NOTICE + " 001234-5",
                         NOTICE + "\nUnexpected introductory text"):
            with self.subTest(preamble=preamble[:20]), self.assertRaisesRegex(ValueError, "Unrecognised chat header"):
                self.parse(preamble + "\n[10/9/26, 2:30:02 AM] You: 001234-5")

    def test_notice_alone_is_not_a_chat(self):
        with self.assertRaisesRegex(ValueError, "No supported WhatsApp message headers"):
            self.parse(NOTICE)

    def test_notice_inside_message_is_preserved(self):
        messages = self.parse("[10/9/26, 2:30:02 AM] You: Original message\n" + NOTICE)
        self.assertEqual(messages[0]["text"], "Original message\n" + NOTICE)


if __name__ == "__main__":
    unittest.main()
