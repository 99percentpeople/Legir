"""Validate authoring-audit PDFs with qpdf and Poppler, independently of the SDK."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from inspect_pdf import inspect


def render(path):
    result = subprocess.run(
        ["pdftoppm", "-singlefile", "-scale-to", "1600", str(path)],
        check=True, capture_output=True,
    )
    if result.stderr.strip():
        raise ValueError(result.stderr.decode())
    return result.stdout


def text(path):
    result = subprocess.run(
        ["pdftotext", "-layout", str(path), "-"],
        check=True, capture_output=True, text=True,
    )
    if result.stderr.strip():
        raise ValueError(result.stderr)
    return result.stdout


candidate, baseline, output = map(Path, sys.argv[1:4])
editable, flat = candidate / "editable.pdf", candidate / "flattened.pdf"
current, flattened, previous = inspect(editable), inspect(flat), inspect(baseline / "editable.pdf")
assert not current["warnings"] and not flattened["warnings"]
assert len(current["pages"]) == len(flattened["pages"]) == 1
assert current["fields"] == previous["fields"] and len(current["fields"]) == 10
assert not flattened["fields"]
current_raster, flat_raster = render(editable), render(flat)
assert current_raster == flat_raster, "Flattening changed pixels"
extracted = text(flat)
for expected in ["中文表单与印章测试", "中文宋体与字体子集", "中文输入", "Alice", "ROTATED", "APPROVED", "A12345", "Second line."]:
    assert "".join(expected.split()) in "".join(extracted.split()), f"Missing text: {expected}"
assert "secret" not in extracted, "Password appearance exposes its value"
result = {
    "ok": True,
    "oracle": "pikepdf/qpdf syntax and form tree; Poppler raster and text extraction",
    "candidate": str(candidate),
    "baselineEditable": str(baseline / "editable.pdf"),
    "baselineFlattenedCompared": False,
    "fields": current["fields"],
    "fieldValuesMatchHistoricalAuthoring": True,
    "editableSyntaxWarnings": current["warnings"],
    "flattenedSyntaxWarnings": flattened["warnings"],
    "flattenedFields": len(flattened["fields"]),
    "editableAndFlattenedPixelsExact": True,
    "rasterPpmSha256": hashlib.sha256(current_raster).hexdigest(),
    "text": extracted,
    "sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [editable, flat]},
}
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"ok": True, "fields": len(current["fields"]), "pixelsExact": True}))
