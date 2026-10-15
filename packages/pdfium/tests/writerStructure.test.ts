import { beforeAll, expect, it } from "vitest";
import {
  createPDFium,
  type PDFDocument,
  type PDFium,
  type SaveOptions,
} from "../src/index.js";

let engine: PDFium;
beforeAll(async () => {
  engine = await createPDFium();
});

const modes = ["buffer", "chunks", "blobs"] as const;
type Mode = (typeof modes)[number];
const encryption: SaveOptions = {
  encrypt: "aes-256",
  "user-password": "reader",
  "owner-password": "owner",
};

// Build the input independently of the writer under test, including gaps and
// an unreferenced highest object. Its original xref must survive delta saves.
function source(version = "1.7") {
  const objects = new Map([
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Count 1 /Kids [3 0 R] >>"],
    [
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Contents 4 0 R >>",
    ],
    [4, "<< /Length 0 >>\nstream\n\nendstream"],
    [10, "<< /Unreachable true >>"],
  ]);
  let text = `%PDF-${version}\n`;
  const offsets = new Map<number, number>();
  for (const [number, object] of objects) {
    offsets.set(number, text.length);
    text += `${number} 0 obj\n${object}\nendobj\n`;
  }
  const start = text.length;
  text += "xref\n0 11\n0000000000 65535 f \n";
  for (let i = 1; i <= 10; i++) {
    text += `${String(offsets.get(i) ?? 0).padStart(10, "0")} 00000 ${offsets.has(i) ? "n" : "f"} \n`;
  }
  return new TextEncoder().encode(
    text + `trailer\n<< /Size 11 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`,
  );
}

function fresh() {
  const doc = new engine.PDFDocument();
  const page = doc.addPage([0, 0, 200, 300], 0, {}, "");
  doc.insertPage(-1, page);
  page.destroy();
  return doc;
}

async function save(
  doc: PDFDocument,
  mode: Mode,
  options: SaveOptions = {},
  prefix?: Uint8Array,
) {
  if (mode === "buffer") {
    const buffer = doc.saveToBuffer(options);
    try {
      return buffer.asUint8Array().slice();
    } finally {
      buffer.destroy();
    }
  }
  const task = doc.startSave(options);
  const parts: Uint8Array[] = task.incremental ? [prefix!] : [];
  try {
    expect(task.incremental).toBe(!!options.incremental);
    for (;;) {
      if (mode === "blobs") {
        const { blob, done } = task.nextBlob();
        parts.push(new Uint8Array(await blob.arrayBuffer()));
        if (done) break;
      } else {
        const { bytes, done } = task.next();
        parts.push(bytes);
        if (done) break;
      }
    }
    return new Uint8Array(Buffer.concat(parts));
  } finally {
    task.destroy();
  }
}

// Inspect the actual classic xref, byte offsets and trailer, without reopening
// through PDFium: a tolerant reader can hide malformed writer output.
function inspect(bytes: Uint8Array, originalSize = 0) {
  const text = new TextDecoder("latin1").decode(bytes);
  const start = Number(text.match(/startxref\s+(\d+)\s+%%EOF\s*$/)?.[1]);
  expect(Number.isFinite(start)).toBe(true);
  expect(text.slice(start, start + 4)).toBe("xref");
  const section = text.slice(start + 4);
  const trailer = section.indexOf("trailer");
  expect(trailer).toBeGreaterThan(0);
  const rows = section.slice(0, trailer).trim().split(/\r?\n/);
  const entries = new Set<number>();
  for (let i = 0; i < rows.length; ) {
    const [first, count] = rows[i++].trim().split(/\s+/).map(Number);
    expect(Number.isFinite(count)).toBe(true);
    for (let j = 0; j < count; j++) {
      const match = rows[i++]?.match(/^(\d{10}) (\d{5}) ([nf])\s*$/);
      expect(match).not.toBeNull();
      const number = first + j;
      entries.add(number);
      if (match![3] === "n") {
        const offset = Number(match![1]);
        const header = `${number} ${Number(match![2])} obj`;
        expect(text.slice(offset, offset + header.length)).toBe(header);
      }
    }
  }
  const dictionary = section.slice(trailer);
  const size = Number(dictionary.match(/\/Size\s+(\d+)/)?.[1]);
  expect(size).toBe(Math.max(originalSize - 1, ...entries) + 1);
  return { size, entries, header: text.split(/\r?\n/)[0], dictionary };
}

it.each(modes)("writes a 1.7 header for a new document (%s)", async (mode) => {
  const doc = fresh();
  try {
    expect(doc.getVersion()).toBe(17);
    expect(inspect(await save(doc, mode)).header).toBe("%PDF-1.7");
  } finally {
    doc.destroy();
  }
});

it.each(["1.4", "1.7", "2.0"])(
  "preserves source version %s when rewriting",
  async (version) => {
    const doc = new engine.PDFDocument(source(version));
    try {
      for (const mode of modes) {
        expect(inspect(await save(doc, mode)).header).toBe(`%PDF-${version}`);
      }
    } finally {
      doc.destroy();
    }
  },
);

it("honors a new document's catalog version override", async () => {
  const doc = fresh();
  try {
    const root = doc.getTrailer().get("Root");
    root.put("Version", "2.0");
    root.destroy();
    expect(doc.getVersion()).toBe(20);
    expect(inspect(await save(doc, "chunks")).header).toBe("%PDF-2.0");
  } finally {
    doc.destroy();
  }
});

it.each(modes)(
  "excludes old unreachable tail objects from full-save Size (%s)",
  async (mode) => {
    const doc = new engine.PDFDocument(source());
    try {
      const result = inspect(await save(doc, mode));
      expect(result.size).toBe(5);
      expect(result.entries.has(10)).toBe(false);
    } finally {
      doc.destroy();
    }
  },
);

it.each(modes)(
  "counts only written new objects, including encryption dictionaries (%s)",
  async (mode) => {
    for (const reopened of [false, true]) {
      for (const encrypted of [false, true]) {
        const doc = reopened ? new engine.PDFDocument(source()) : fresh();
        try {
          const page = doc.findPage(0);
          const marker = doc.addObject({ Marker: 42 });
          page.put("Marker", marker);
          marker.destroy();
          page.destroy();
          doc.addObject({ Unreachable: true }).destroy();
          const bytes = await save(doc, mode, encrypted ? encryption : {});
          const result = inspect(bytes);
          if (encrypted) {
            const ref = Number(
              result.dictionary.match(/\/Encrypt\s+(\d+)/)?.[1],
            );
            expect(result.entries.has(ref)).toBe(true);
          }
          const check = new engine.PDFDocument(
            bytes,
            encrypted ? "reader" : "",
          );
          try {
            expect(check.countPages()).toBe(1);
            const value = check.findPage(0).get("Marker", "Marker");
            expect(value.asNumber()).toBe(42);
            value.destroy();
          } finally {
            check.destroy();
          }
        } finally {
          doc.destroy();
        }
      }
    }
  },
);

it.each(["chunks", "blobs"] as const)(
  "keeps the original xref extent on incremental saves and rollback (%s)",
  async (mode) => {
    const original = source();
    const doc = new engine.PDFDocument(original);
    try {
      for (const changed of [false, true]) {
        doc.beginOperation();
        try {
          if (changed) {
            const page = doc.findPage(0);
            const marker = doc.addObject({ Value: 42 });
            page.put("Marker", marker);
            marker.destroy();
            page.destroy();
          }
          doc.addObject({ Unreachable: true }).destroy();
          const bytes = await save(doc, mode, { incremental: true }, original);
          expect(bytes.subarray(0, original.length)).toEqual(original);
          expect(inspect(bytes, 11).size).toBe(changed ? 12 : 11);
        } finally {
          doc.abandonOperation();
        }
      }
      expect(
        inspect(await save(doc, mode, { incremental: true }, original), 11)
          .size,
      ).toBe(11);
    } finally {
      doc.destroy();
    }
  },
);

it("retains the correct xref after yielding, cancelling and retrying a full save", async () => {
  const doc = new engine.PDFDocument(source());
  try {
    const page = doc.findPage(0);
    const stream = doc.addObject({ Filter: "ASCIIHexDecode" });
    stream.writeRawStream(new Uint8Array(5 * 1024 * 1024).fill(65));
    page.put("LargeResource", stream);
    stream.destroy();
    const last = doc.addObject({ Marker: 42 });
    page.put("Last", last);
    last.destroy();
    page.destroy();
    doc.addObject({ Unreachable: true }).destroy();
    const task = doc.startSave();
    try {
      expect(task.next().done).toBe(false);
    } finally {
      task.destroy();
    }
    const bytes = await save(doc, "chunks");
    expect(inspect(bytes).size).toBe(13);
    const reopened = new engine.PDFDocument(bytes);
    try {
      expect(reopened.countPages()).toBe(1);
    } finally {
      reopened.destroy();
    }
  } finally {
    doc.destroy();
  }
  expect(engine.liveDocuments()).toBe(0);
});
