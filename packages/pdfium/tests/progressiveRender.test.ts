import { beforeAll, expect, it } from "vitest";
import {
  createPDFium,
  type PDFium,
  type Matrix,
  type Rect,
} from "../src/index.js";

let engine: PDFium;
beforeAll(async () => {
  engine = await createPDFium();
});

function fixture() {
  const doc = new engine.PDFDocument();
  const commands = Array.from(
    { length: 18000 },
    (_, i) =>
      `${(i % 3) / 2} ${(i % 7) / 6} 0.5 rg ${i % 400} ${Math.floor(i / 400) * 7} 3 6 re f`,
  ).join("\n");
  const page = doc.addPage([0, 0, 400, 400], 0, {}, commands);
  doc.insertPage(-1, page);
  page.destroy();
  return doc;
}

it.each([
  {
    matrix: [1, 0, 0, -1, 0, 400],
    bounds: [0, 0, 400, 400],
    transparent: false,
  },
  {
    matrix: [0, 2, 2, 0, 0, 0],
    bounds: [125, 211, 625, 611],
    transparent: true,
  },
])(
  "resumes to identical synchronous pixels with clipping and rotation: $transparent",
  ({ matrix, bounds, transparent }) => {
    const doc = fixture();
    try {
      const page = doc.loadPage(0);
      const bitmap = page.render(matrix as Matrix, bounds as Rect, {
        transparent,
      });
      const expected = bitmap.getPixels().slice();
      bitmap.destroy();
      const task = page.startRender(matrix as Matrix, bounds as Rect, {
        transparent,
      });
      try {
        expect(() => task.finish()).toThrow("not finished");
        expect(() => page.render(matrix as Matrix, bounds as Rect)).toThrow(
          "active render",
        );
        let slices = 1;
        while (!task.continue(1)) {
          if (++slices > 10000) throw Error("Render did not finish");
        }
        expect(slices).toBeGreaterThan(1);
        const actual = task.finish();
        try {
          expect(
            Buffer.from(actual.getPixels()).equals(Buffer.from(expected)),
          ).toBe(true);
        } finally {
          actual.destroy();
        }
        expect(page.renderTasks.size).toBe(0);
        expect(() => task.continue()).toThrow("closed");
      } finally {
        task.destroy();
      }
    } finally {
      doc.destroy();
    }
  },
);

it("cancels without poisoning the page and closes outstanding tasks with the document", () => {
  const doc = fixture();
  try {
    const page = doc.loadPage(0);
    const first = page.startRender([1, 0, 0, -1, 0, 400], [0, 0, 400, 400]);
    expect(first.continue(1)).toBe(false);
    first.destroy();
    const next = page.startRender([1, 0, 0, -1, 0, 400], [0, 0, 400, 400]);
    next.continue(1);
    expect(() => next.continue(0)).toThrow("positive");
    doc.destroy();
    expect(next.pointer).toBe(0);
    expect(page.renderTasks.size).toBe(0);
    expect(engine.liveDocuments()).toBe(0);
  } finally {
    doc.destroy();
  }
});

it.each([
  { matrix: [1, 0, 0, -1, 0, 160], bounds: [0, 0, 240, 160] },
  { matrix: [0, 2, 2, 0, 0, 0], bounds: [31, 57, 271, 377] },
])(
  "blends annotations onto an opaque backdrop with full-render parity: $matrix",
  ({ matrix, bounds }) => {
    const doc = new engine.PDFDocument();
    try {
      const appearance = doc.addObject({
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 100, 100],
        Resources: { ExtGState: { GS: { BM: "Multiply", ca: 0.6 } } },
        Group: { S: "Transparency", I: false, K: false },
      });
      appearance.writeStream(
        new TextEncoder().encode(
          "/GS gs 0.9 0.8 0.1 rg 0 0 100 100 re f 0.2 0.9 0.7 rg 20 20 60 60 re f",
        ),
      );
      const object = doc.addPage(
        [0, 0, 240, 160],
        0,
        {},
        "0.3 0.5 0.8 rg 0 0 240 160 re f 0.8 0.1 0.2 rg 50 20 80 120 re f",
      );
      object.put("Annots", [
        doc.addObject({
          Type: "Annot",
          Subtype: "Stamp",
          Rect: [30, 30, 130, 130],
          F: 4,
          AP: { N: appearance },
        }),
      ]);
      doc.insertPage(-1, object);
      const page = doc.loadPage(0);
      const expected = page.render(matrix as Matrix, bounds as Rect, {
        annotations: true,
      });
      const body = page.render(matrix as Matrix, bounds as Rect, {
        annotations: false,
      });
      try {
        expect(
          Buffer.from(body.getPixels()).equals(
            Buffer.from(expected.getPixels()),
          ),
        ).toBe(false);
        const task = page.startRender(matrix as Matrix, bounds as Rect, {
          contents: false,
          annotations: true,
        });
        try {
          task.setBackground(body.getPixels().slice());
          while (!task.continue(1)) {
            /* cooperative render */
          }
          expect(() => task.setBackground(body.getPixels())).toThrow("precede");
          const actual = task.finish();
          try {
            expect(
              Buffer.from(actual.getPixels()).equals(
                Buffer.from(expected.getPixels()),
              ),
            ).toBe(true);
            expect(engine.liveDocuments()).toBe(1);
          } finally {
            actual.destroy();
          }
        } finally {
          task.destroy();
        }
      } finally {
        body.destroy();
        expected.destroy();
      }
    } finally {
      doc.destroy();
    }
    expect(engine.liveDocuments()).toBe(0);
  },
);

it("rejects invalid or closed render backdrops", () => {
  const doc = fixture();
  const page = doc.loadPage(0);
  const task = page.startRender([1, 0, 0, -1, 0, 400], [0, 0, 10, 10]);
  try {
    expect(() => task.setBackground(new Uint8Array(4))).toThrow("dimensions");
    expect(() => task.setBackground(new Uint8Array(400))).toThrow("opaque");
    task.destroy();
    expect(() => task.setBackground(new Uint8Array(400))).toThrow("closed");
  } finally {
    task.destroy();
    doc.destroy();
  }
});
