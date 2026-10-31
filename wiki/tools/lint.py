#!/usr/bin/env python3
"""Wiki lint: broken [[links]], pages missing from index.md, stale facts, oversized pages.

Usage: python3 wiki/tools/lint.py   (prints issues, exit 1 if any)
"""
import datetime
import pathlib
import re
import sys

WIKI = pathlib.Path(__file__).resolve().parent.parent
SKIP_DIRS = {"inbox", "tools"}
STALE_DAYS = 90
MAX_LINES = 150

pages = {
    p.stem: p
    for p in WIKI.rglob("*.md")
    if not SKIP_DIRS.intersection(p.relative_to(WIKI).parts[:-1])
}
index_text = (WIKI / "index.md").read_text()
today = datetime.date.today()
issues = []

for name, path in sorted(pages.items()):
    rel = path.relative_to(WIKI)
    text = path.read_text()
    for link in sorted(set(re.findall(r"\[\[([^\]|#]+)", text))) if name not in {"README", "CONSOLIDATE"} else []:
        if link.strip() not in pages:
            issues.append(f"broken link [[{link}]] in {rel}")
    if name not in {"index", "README", "CONSOLIDATE", "log"} and f"[[{name}]]" not in index_text:
        issues.append(f"not in index.md: {rel}")
    m = re.search(r"^last_verified:\s*(\d{4}-\d{2}-\d{2})", text, re.M)
    if m and (today - datetime.date.fromisoformat(m.group(1))).days > STALE_DAYS:
        issues.append(f"stale last_verified {m.group(1)} in {rel}")
    lines = text.count("\n")
    if lines > MAX_LINES and name != "log":
        issues.append(f"{rel} has {lines} lines (> {MAX_LINES}), consider splitting")

for issue in issues:
    print(issue)
print(f"{len(issues)} issue(s), {len(pages)} pages")
sys.exit(1 if issues else 0)
