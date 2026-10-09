"""Create labelled test inputs only; all result data comes from the real backend."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[2]
destination = Path(__file__).resolve().parents[1] / ".verification"
destination.mkdir(exist_ok=True)

fixtures = {
    "text.zip": "09/10/2026, 10:00 - Frontend verification: 001234-5\n007890*2\n001234-5\n09/10/2026, 10:01 - Frontend verification: image omitted\n",
    "image.zip": "09/10/2026, 10:02 - Frontend verification: sample.jpg\n",
    "empty.zip": "09/10/2026, 10:00 - Frontend verification system notice\n",
    "escaped.zip": '09/10/2026, 10:00 - Frontend verification: image omitted <img src=x onerror="window.sourceExecuted=true">\n',
}
for name, chat in fixtures.items():
    with zipfile.ZipFile(destination / name, "w") as archive:
        archive.writestr("chat.txt", chat)
        if name == "image.zip":
            archive.write(root / "sample.jpg", "sample.jpg")
