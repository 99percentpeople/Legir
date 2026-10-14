import { beforeAll, expect, it } from "vitest";
import { createPDFium, type PDFium, type PDFDocument } from "../src/index.js";

let engine: PDFium;
beforeAll(async () => {
  engine = await createPDFium();
});

function fixture() {
  const doc = new engine.PDFDocument();
  for (let i = 0; i < 20; i++) {
    const page = doc.addPage([0, 0, 200, 300], 0, {}, "");
    const stream = doc.addObject({ Filter: "ASCIIHexDecode" });
    stream.writeRawStream(new Uint8Array(512 * 1024).fill(65));
    page.put("PieceInfo", stream);
    doc.insertPage(-1, page);
    page.destroy();
    stream.destroy();
  }
  return doc;
}
function collect(doc: PDFDocument, encrypted = false) {
  const task = doc.startSave(
    encrypted
      ? {
          encrypt: "aes-256",
          "user-password": "reader",
          "owner-password": "owner",
          permissions: -3904,
        }
      : {},
  );
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const next = task.next();
      chunks.push(next.bytes);
      if (next.done) break;
    }
  } finally {
    task.destroy();
  }
  const bytes = new Uint8Array(
    chunks.reduce((n, chunk) => n + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, chunks };
}

it.each([false, true])(
  "resumes old/new objects across chunks and reopens correctly (AES: %s)",
  (encrypted) => {
    const source = fixture();
    let doc: PDFDocument | undefined;
    try {
      const first = collect(source);
      expect(first.chunks.length).toBeGreaterThan(1);
      expect(Math.max(...first.chunks.map((c) => c.length))).toBeLessThan(
        5 * 1024 * 1024,
      );
      doc = new engine.PDFDocument(first.bytes);
      const page = doc.addPage([0, 0, 400, 600], 90, {}, "");
      doc.insertPage(-1, page);
      page.destroy();
      const { bytes } = collect(doc, encrypted);
      const reopened = new engine.PDFDocument(bytes, encrypted ? "reader" : "");
      try {
        expect(reopened.countPages()).toBe(21);
        for (let i = 0; i < 20; i++) {
          const object = reopened.findPage(i),
            stream = object.get("PieceInfo"),
            data = stream.readRawStream();
          try {
            expect(data.asUint8Array().length).toBe(512 * 1024);
            expect(data.asUint8Array()[512 * 1024 - 1]).toBe(65);
          } finally {
            data.destroy();
            stream.destroy();
            object.destroy();
          }
        }
        if (encrypted) {
          expect(reopened.needsPassword()).toBe(false);
          expect(reopened.authenticatePassword("owner")).toBe(4);
        }
      } finally {
        reopened.destroy();
      }
    } finally {
      doc?.destroy();
      source.destroy();
    }
  },
);

it("can abandon a partial save and then render/save the same PDF again", () => {
  const doc = fixture();
  try {
    const task = doc.startSave();
    expect(task.next().done).toBe(false);
    task.destroy();
    expect(() => task.next()).toThrow(/closed/);
    const page = doc.loadPage(0),
      bitmap = page.toPixmap(engine.Matrix.scale(0.2, 0.2));
    bitmap.destroy();
    page.destroy();
    expect(collect(doc).bytes.length).toBeGreaterThan(10 * 1024 * 1024);
    const pending = doc.startSave();
    doc.destroy();
    expect(() => pending.next()).toThrow(/closed/);
  } finally {
    doc.destroy();
  }
  expect(engine.liveDocuments()).toBe(0);
});

it("keeps Blob chunks immutable while reusing the native working buffer", async () => {
  const doc = fixture();
  const task = doc.startSave();
  const parts: Blob[] = [];
  try {
    for (;;) {
      const { blob, done } = task.nextBlob();
      parts.push(blob);
      if (done) break;
    }
    expect(parts.length).toBeGreaterThan(1);
    const reopened = new engine.PDFDocument(
      new Uint8Array(await new Blob(parts).arrayBuffer()),
    );
    try {
      expect(reopened.countPages()).toBe(20);
    } finally {
      reopened.destroy();
    }
  } finally {
    task.destroy();
    doc.destroy();
  }
});
