import { beforeAll, expect, it } from "vitest";
import { createPDFium, type PDFium, type PDFDocument } from "../src/index.js";

let engine: PDFium;
beforeAll(async () => {
  engine = await createPDFium();
});
function save(doc: PDFDocument) {
  const buffer = doc.saveToBuffer();
  try {
    return buffer.asUint8Array().slice();
  } finally {
    buffer.destroy();
  }
}
function append(doc: PDFDocument, original: Uint8Array) {
  const task = doc.startSave({ incremental: true });
  const incremental = task.incremental;
  const parts: Uint8Array[] = incremental ? [original] : [];
  try {
    for (;;) {
      const { bytes, done } = task.next();
      parts.push(bytes);
      if (done) break;
    }
  } finally {
    task.destroy();
  }
  const output = new Uint8Array(
    parts.reduce((size, bytes) => size + bytes.length, 0),
  );
  let position = 0;
  for (const part of parts) {
    output.set(part, position);
    position += part.length;
  }
  return {
    output,
    incremental,
    deltaBytes: output.length - (incremental ? original.length : 0),
  };
}
function fixture() {
  const doc = new engine.PDFDocument();
  const page = doc.addPage([0, 0, 400, 300], 0, {}, "");
  page.put("Nested", { Values: [1, 2], Existing: 3 });
  const large = doc.addObject({ Filter: "ASCIIHexDecode" });
  large.writeRawStream(new Uint8Array(8 * 1024 * 1024).fill(65));
  page.put("Unchanged", large);
  doc.insertPage(-1, page);
  page.destroy();
  large.destroy();
  try {
    return save(doc);
  } finally {
    doc.destroy();
  }
}

it("appends changed inline children and new references without rewriting large streams", () => {
  const original = fixture();
  const doc = new engine.PDFDocument(original);
  try {
    const page = doc.findPage(0),
      nested = page.get("Nested"),
      values = nested.get("Values");
    doc.beginOperation();
    values.put(0, 42);
    nested.delete("Existing");
    const added = doc.addObject({ Marker: doc.newString("new resource") });
    nested.put("Added", added);
    added.destroy();
    const result = append(doc, original);
    expect(result.incremental).toBe(true);
    expect(result.deltaBytes).toBeLessThan(4096);
    const reopened = new engine.PDFDocument(result.output);
    try {
      const p = reopened.findPage(0),
        n = p.get("Nested"),
        v = n.get("Values", 0),
        a = n.get("Added", "Marker"),
        gone = n.get("Existing");
      expect(v.asNumber()).toBe(42);
      expect(a.asString()).toBe("new resource");
      expect(gone.isNull()).toBe(true);
      gone.destroy();
      a.destroy();
      v.destroy();
      n.destroy();
      p.destroy();
    } finally {
      reopened.destroy();
    }
    doc.abandonOperation();
    expect(values.get(0).asNumber()).toBe(1);
    const afterRollback = append(doc, original);
    const check = new engine.PDFDocument(afterRollback.output);
    const restored = check.findPage(0).get("Nested", "Values", 0);
    expect(restored.asNumber()).toBe(1);
    restored.destroy();
    check.destroy();
    values.destroy();
    nested.destroy();
    page.destroy();
  } finally {
    doc.destroy();
  }
  expect(engine.liveDocuments()).toBe(0);
});

it("reopens an append and appends a second revision with valid offsets", () => {
  let bytes = fixture();
  for (let index = 0; index < 3; index++) {
    const doc = new engine.PDFDocument(bytes);
    const page = doc.findPage(0);
    page.put("Revision", index);
    const result = append(doc, bytes);
    expect(result.incremental).toBe(true);
    expect(result.deltaBytes).toBeLessThan(4096);
    bytes = result.output;
    page.destroy();
    doc.destroy();
  }
  const check = new engine.PDFDocument(bytes);
  const revision = check.findPage(0).get("Revision");
  expect(revision.asNumber()).toBe(2);
  revision.destroy();
  check.destroy();
});

it("does not propagate dirty state through page parents and sibling references", () => {
  const source = new engine.PDFDocument();
  for (let index = 0; index < 100; index++) {
    const page = source.addPage([0, 0, 200, 200], 0, {}, "");
    source.insertPage(-1, page);
    page.destroy();
  }
  const original = save(source);
  source.destroy();
  const doc = new engine.PDFDocument(original);
  // Hydrate the whole page tree as the app does before export.
  for (let index = 0; index < 100; index++) doc.findPage(index).destroy();
  const page = doc.findPage(50);
  page.put("Marker", 123);
  const result = append(doc, original);
  expect(result.incremental).toBe(true);
  expect(result.deltaBytes).toBeLessThan(1024);
  const reopened = new engine.PDFDocument(result.output);
  expect(reopened.countPages()).toBe(100);
  const marker = reopened.findPage(50).get("Marker");
  expect(marker.asNumber()).toBe(123);
  marker.destroy();
  reopened.destroy();
  page.destroy();
  doc.destroy();
});

it("falls back for new and encrypted PDFs", () => {
  const fresh = new engine.PDFDocument();
  const page = fresh.addPage([0, 0, 200, 200], 0, {}, "");
  fresh.insertPage(-1, page);
  page.destroy();
  expect(append(fresh, new Uint8Array()).incremental).toBe(false);
  const buffer = fresh.saveToBuffer({
    encrypt: "aes-256",
    "user-password": "reader",
  });
  const bytes = buffer.asUint8Array().slice();
  buffer.destroy();
  fresh.destroy();
  const doc = new engine.PDFDocument(bytes, "reader");
  const result = append(doc, bytes);
  expect(result.incremental).toBe(false);
  const output = new engine.PDFDocument(result.output);
  expect(output.needsPassword()).toBe(false);
  output.destroy();
  doc.destroy();
});

it("rewrites redacted text, but restores append eligibility after rollback", () => {
  const source = new engine.PDFDocument();
  const font = source.addObject({
    Type: "Font",
    Subtype: "Type1",
    BaseFont: "Helvetica",
  });
  const originalPage = source.addPage(
    [0, 0, 300, 200],
    0,
    { Font: { F1: font } },
    "BT /F1 20 Tf 30 140 Td (SECRET) Tj ET",
  );
  source.insertPage(-1, originalPage);
  const bytes = save(source);
  originalPage.destroy();
  font.destroy();
  source.destroy();
  const doc = new engine.PDFDocument(bytes);
  doc.beginOperation();
  const page = doc.loadPage(0);
  page.redactText([[0, 200, 300, 200, 0, 0, 300, 0]]);
  page.destroy();
  const result = append(doc, bytes);
  expect(result.incremental).toBe(false);
  const check = new engine.PDFDocument(result.output);
  const checkPage = check.loadPage(0);
  expect(checkPage.extractText().text).not.toContain("SECRET");
  checkPage.destroy();
  check.destroy();
  doc.abandonOperation();
  const restored = append(doc, bytes);
  expect(restored.incremental).toBe(true);
  const restoredDoc = new engine.PDFDocument(restored.output);
  const restoredPage = restoredDoc.loadPage(0);
  expect(restoredPage.extractText().text).toContain("SECRET");
  restoredPage.destroy();
  restoredDoc.destroy();
  doc.destroy();
});

it.each(["generation", "repaired"])(
  "rewrites an input with %s cross-references",
  (mode) => {
    const generation = mode === "generation" ? 2 : 0;
    let text = "%PDF-1.7\n";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Count 1 /Kids [3 ${generation} R] >>`,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
    ];
    const offsets = objects.map((body, index) => {
      const offset = text.length;
      text += `${index + 1} ${index === 2 ? generation : 0} obj\n${body}\nendobj\n`;
      return offset;
    });
    const xref = text.length;
    text += "xref\n0 4\n0000000000 65535 f\n";
    offsets.forEach((offset, index) => {
      text += `${String(offset).padStart(10, "0")} ${String(index === 2 ? generation : 0).padStart(5, "0")} n\n`;
    });
    text += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${mode === "repaired" ? 1 : xref}\n%%EOF\n`;
    const bytes = new TextEncoder().encode(text);
    const doc = new engine.PDFDocument(bytes);
    expect(doc.countPages()).toBe(1);
    const result = append(doc, bytes);
    expect(result.incremental).toBe(false);
    const check = new engine.PDFDocument(result.output);
    expect(check.countPages()).toBe(1);
    check.destroy();
    doc.destroy();
  },
);

it("cancels a multi-chunk delta and rolls back changed stream bytes before retrying", () => {
  const original = fixture();
  const doc = new engine.PDFDocument(original);
  doc.beginOperation();
  const page = doc.findPage(0),
    stream = page.get("Unchanged");
  stream.writeRawStream(new Uint8Array(8 * 1024 * 1024).fill(66));
  const marker = doc.addObject({ Value: 7 });
  page.put("Marker", marker);
  const task = doc.startSave({ incremental: true });
  expect(task.incremental).toBe(true);
  expect(task.nextBlob().done).toBe(false);
  task.destroy();
  doc.abandonOperation();
  expect(doc.saves.size).toBe(0);
  const result = append(doc, original);
  expect(result.incremental).toBe(true);
  expect(result.deltaBytes).toBeLessThan(1024);
  const check = new engine.PDFDocument(result.output);
  const value = check.findPage(0).get("Unchanged").readRawStream();
  expect(value.asUint8Array()[0]).toBe(65);
  value.destroy();
  check.destroy();
  marker.destroy();
  stream.destroy();
  page.destroy();
  doc.destroy();
});
