#!/usr/bin/env python3
"""Copy the App Store screenshots taken by the iOS UI tests into docs/appstore/screenshots.

Usage: python3 scripts/ios-appstore-screenshots.py <exported-attachments-dir>

<exported-attachments-dir> is the output of
  xcrun xcresulttool export attachments --path build/UITests.xcresult --output-path <dir>
(CI publishes it as screenshots/ on the ios-ci-output branch). Only attachments named
en-N-... / zh-N-... (test2_screenshots) are copied; every image must be 1320 x 2868
(App Store 6.9" iPhone display).
"""
import json
import re
import shutil
import struct
import sys
from pathlib import Path

src = Path(sys.argv[1])
dst = Path(__file__).resolve().parent.parent / "docs" / "appstore" / "screenshots"
folders = {"en": "en", "zh": "zh-Hans"}
want = (1320, 2868)


def png_size(p: Path) -> tuple[int, int]:
    with p.open("rb") as f:
        head = f.read(24)
    assert head[:8] == b"\x89PNG\r\n\x1a\n", f"{p} is not a PNG"
    return struct.unpack(">II", head[16:24])


copied = 0
for test in json.loads((src / "manifest.json").read_text()):
    for a in test.get("attachments", []):
        m = re.match(r"^(en|zh)-([1-5])-([a-z-]+?)_\d+_", a["suggestedHumanReadableName"])
        if not m:
            continue
        lang, n, name = m.groups()
        f = src / a["exportedFileName"]
        size = png_size(f)
        if size != want:
            sys.exit(f"{f.name}: {size[0]}x{size[1]}, expected {want[0]}x{want[1]}")
        out = dst / folders[lang] / f"{n}-{name}.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(f, out)
        print(f"{out.relative_to(dst.parent.parent.parent)}  {size[0]}x{size[1]}")
        copied += 1

if copied == 0:
    sys.exit("no en-N-* / zh-N-* screenshots found")

# two identical screenshots mean a screen did not change (wrong screen captured): never ship that
import hashlib
seen = {}
for f in sorted(dst.glob("*/*.png")):
    h = hashlib.sha256(f.read_bytes()).hexdigest()
    if h in seen:
        sys.exit(f"identical screenshots: {seen[h].relative_to(dst)} and {f.relative_to(dst)}")
    seen[h] = f
