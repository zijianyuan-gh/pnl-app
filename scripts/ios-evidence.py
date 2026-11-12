#!/usr/bin/env python3
"""Copy the test-evidence screenshots of an iOS CI run into docs/acceptance/ (scaled to 1x).

Usage: python3 scripts/ios-evidence.py <ios-ci-output checkout>
(the ios-ci-output branch: screenshots/ = exported XCUITest attachments, ipad-compat.png).
Needs Pillow. Images show synthetic demo data only.
"""
import json
import re
import shutil
import sys
from pathlib import Path

from PIL import Image

src = Path(sys.argv[1])
dst = Path(__file__).resolve().parent.parent / "docs" / "acceptance"
dst.mkdir(parents=True, exist_ok=True)

# attachment name (as given in AppUITests.swift) -> evidence file name
wanted = {
    "kbd-quick-add": "01-keyboard-quick-add",
    "en-6-share-sheet": "02-share-sheet",
    "link-1-safari": "03-privacy-link-opens-safari",
    "picker-PWA backup": "04-files-picker",
    "restore-1-verified": "05-restore-checksum-verified",
    "save-2-folder": "06-save-to-files",
    "restore-2-tampered-refused": "07-tampered-backup-refused",
    "csv-1-preview": "08-csv-import-preview",
    "lock-1-locked": "09-app-lock-face-id",
}
found = {}
for test in json.loads((src / "screenshots" / "manifest.json").read_text()):
    for a in test.get("attachments", []):
        name = re.sub(r"_\d+_[0-9A-F-]{36}\.\w+$", "", a["suggestedHumanReadableName"])
        if name in wanted:
            found[wanted[name]] = src / "screenshots" / a["exportedFileName"]
ipad = src / "ipad-compat.png"
if ipad.exists():
    found["10-ipad-compatibility"] = ipad

for out, f in sorted(found.items()):
    im = Image.open(f).convert("RGB")
    scale = 440 / im.width if im.width < 1500 else 660 / im.width  # iPhone 3x → 1x; iPad → 660 wide
    im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS).save(dst / f"{out}.png", optimize=True)
    print(f"docs/acceptance/{out}.png")
missing = sorted((set(wanted.values()) | {"10-ipad-compatibility"}) - set(found))
if missing:
    print("missing:", ", ".join(missing))
shutil.copyfile(src / "COMMIT", dst / "COMMIT")
