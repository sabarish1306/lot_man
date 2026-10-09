"""Manual text-model smoke check: python -m tests.test_text."""

import json


def main():
    # Import model dependencies only when explicitly running this script.
    from logging_config import configure_logging
    from services.text_service import extract_tickets

    configure_logging()
    message = """
001234-5
007890*2
004321.3
009876,4
"""
    result = extract_tickets(message)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
