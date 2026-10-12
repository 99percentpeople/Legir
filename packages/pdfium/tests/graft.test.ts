import { deflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { createPDFium, type PDFium, type PDFDocument } from "../src/index.js";

let engine: PDFium;
beforeAll(async () => {
  engine = await createPDFium();
});
function save(doc: PDFDocument) {
  const output = doc.saveToBuffer();
  try {
    return output.asUint8Array().slice();
  } finally {
    output.destroy();
  }
}

describe("native graft and batched page edits", () => {
  it("can roll back a rejected deep graft without leaving new objects or handles", () => {
    const source = new engine.PDFDocument(),
      target = new engine.PDFDocument();
    let nested = source.newArray();
    for (let i = 0; i < 110; i++) {
      const parent = source.newArray();
      parent.push(nested);
      nested.destroy();
      nested = parent;
    }
    const original = source.addObject(nested);
    const count = target.countObjects();
    const graft = target.newGraftMap();
    target.beginOperation();
    try {
      expect(() => graft.graftObject(original)).toThrow(/nesting limit/);
    } finally {
      graft.destroy();
      target.abandonOperation();
    }
    try {
      expect(target.countObjects()).toBe(count);
    } finally {
      source.destroy();
      target.destroy();
    }
  });
  it("preserves indirect aliases without assigning two numbers to one body", () => {
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [] /Count 0 >>",
      "4 0 R",
      "<< /Value 42 >>",
    ];
    let text = "%PDF-1.7\n";
    const offsets = [0];
    for (const [index, object] of objects.entries()) {
      offsets.push(text.length);
      text += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = text.length;
    text += `xref\n0 5\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const source = new engine.PDFDocument(new TextEncoder().encode(text)),
      target = new engine.PDFDocument();
    const body = source.newIndirect(4),
      alias = source.newIndirect(3);
    const graft = target.newGraftMap();
    try {
      const second = graft.graftObject(alias);
      const copied = graft.graftObject(body);
      expect(copied.get("Value").asNumber()).toBe(42);
      expect(second.resolve().asIndirect()).toBe(copied.asIndirect());
      target.getTrailer().get("Root").put("Alias", second);
      const output = new TextDecoder().decode(save(target));
      expect(output).toMatch(
        new RegExp(
          `${second.asIndirect()} 0 obj\\s+${copied.asIndirect()} 0 R`,
        ),
      );
    } finally {
      graft.destroy();
      source.destroy();
      target.destroy();
    }
  });
  it.each([false, true])(
    "preserves shared references, cycles, encoded streams and inherited pages across runtimes: %s",
    async (separateRuntime) => {
      const sourceEngine = separateRuntime ? await createPDFium() : engine;
      const source = new sourceEngine.PDFDocument();
      const target = new engine.PDFDocument();
      const encoded = new Uint8Array(
        deflateSync("q 0 0 1 rg 10 10 20 20 re f Q"),
      );
      const stream = source.addObject({ Filter: "FlateDecode" });
      stream.writeRawStream(encoded);
      const shared = source.addObject({ Precise: [16777217, 1.000000000001] });
      shared.put("Self", shared);
      const name = source.newNameBytes(new Uint8Array([75, 255, 128]));
      shared.put(name, new Uint8Array([0, 255, 13, 128]));
      const pages = [0, 1, 2].map(() =>
        source.addObject({ Type: "Page", Contents: stream, Custom: shared }),
      );
      source.insertPages(-1, pages);
      const root = source.getTrailer().get("Root", "Pages");
      root.put("MediaBox", [0, 0, 300, 200]);
      root.put("Rotate", 90);
      pages[2].put("Unselected", source.newString("DO NOT COPY THIS PAGE"));
      const graft = target.newGraftMap({ copyPages: true });
      try {
        const copied = pages.slice(0, 2).map((page) => graft.graftObject(page));
        for (const page of copied)
          expect(page.get("Parent").isNull()).toBe(true);
        target.insertPages(-1, copied);
        const first = copied[0].get("Custom"),
          second = copied[1].get("Custom");
        expect(first.asIndirect()).toBe(second.asIndirect());
        expect(first.get("Self").asIndirect()).toBe(first.asIndirect());
        expect(graft.getReferences(source).get(shared.asIndirect())).toBe(
          first.asIndirect(),
        );
        expect(copied[0].get("Rotate").asNumber()).toBe(90);
        expect(copied[0].get("MediaBox", 2).asNumber()).toBe(300);
        const raw = copied[0].get("Contents").readRawStream();
        try {
          expect(raw.asUint8Array()).toEqual(encoded);
        } finally {
          raw.destroy();
        }
        for (const page of copied) page.destroy();
        graft.destroy();
        source.destroy();
        const output = save(target);
        expect(new TextDecoder().decode(output)).not.toContain(
          "DO NOT COPY THIS PAGE",
        );
        const reopened = new engine.PDFDocument(output);
        try {
          expect(reopened.countPages()).toBe(2);
          const object = reopened.findPage(0).get("Custom");
          expect(object.get("Precise", 0).asNumber()).toBe(16777217);
          expect(object.get("Precise", 1).asNumber()).toBe(1.000000000001);
          const key = reopened.newNameBytes(new Uint8Array([75, 255, 128]));
          expect(object.get(key).asByteString()).toEqual(
            new Uint8Array([0, 255, 13, 128]),
          );
          const page = reopened.loadPage(0),
            raster = page.toPixmap(engine.Matrix.identity);
          try {
            expect(raster.getPixels().some((n) => n !== 255)).toBe(true);
          } finally {
            raster.destroy();
            page.destroy();
          }
        } finally {
          reopened.destroy();
        }
      } finally {
        graft.destroy();
        source.destroy();
        target.destroy();
      }
    },
  );

  it("isolates copies within one document and rolls back batched insert/delete", () => {
    const doc = new engine.PDFDocument();
    const page = doc.addPage([0, 0, 300, 200], 0, {}, "q Q");
    doc.insertPage(-1, page);
    const count = doc.countObjects();
    doc.beginOperation();
    const graft = doc.newGraftMap({
      copyWithinDocument: true,
      copyPages: true,
    });
    try {
      const copy = graft.graftObject(page);
      expect(copy.asIndirect()).not.toBe(page.asIndirect());
      expect(copy.get("Contents").asIndirect()).not.toBe(
        page.get("Contents").asIndirect(),
      );
      copy.get("Contents").writeStream(new TextEncoder().encode("MODIFIED"));
      const original = page.get("Contents").readStream();
      try {
        expect(new TextDecoder().decode(original.asUint8Array())).toBe("q Q");
      } finally {
        original.destroy();
      }
      doc.insertPages(-1, [copy]);
      doc.deletePages([0, 0]);
      expect(doc.countPages()).toBe(1);
      expect(doc.findPage(0).asIndirect()).toBe(copy.asIndirect());
      copy.destroy();
    } finally {
      graft.destroy();
      doc.abandonOperation();
    }
    try {
      expect(doc.countPages()).toBe(1);
      expect(doc.countObjects()).toBe(count);
      expect(doc.findPage(0).asIndirect()).toBe(page.asIndirect());
      const reopened = new engine.PDFDocument(save(doc));
      try {
        expect(reopened.countPages()).toBe(1);
      } finally {
        reopened.destroy();
      }
    } finally {
      doc.destroy();
    }
    expect(() => graft.graftObject(page)).toThrow(/closed/);
  });
});
