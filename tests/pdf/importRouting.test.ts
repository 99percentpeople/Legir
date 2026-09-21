import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFString } from "@cantoo/pdf-lib";
import { loadPDF } from "@/services/pdfService";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import * as stampVector from "@/services/pdfService/lib/stampVector";
import { PDF_CUSTOM_KEYS } from "@/constants";

const worker = (destination: number | null = 1) => ({
  loadDocument: vi.fn(async () => true),
  resolveDest: vi.fn(async () => destination),
  getOutline: vi.fn(async () => []),
  getPermissions: vi.fn(async () => null),
  renderPageImage: vi.fn(async () => undefined),
});

afterEach(() => vi.restoreAllMocks());

const linksPdf = async (
  kind: "explicit" | "named" | "invalid",
  count = 100,
) => {
  const doc = await PDFDocument.create();
  const first = doc.addPage([300, 300]);
  const second = doc.addPage([300, 300]);
  for (let index = 0; index < count; index++) {
    const dest =
      kind === "named"
        ? PDFString.of("chapter")
        : kind === "invalid"
          ? doc.context.obj([2, "Fit"])
          : doc.context.obj([second.ref, "Fit"]);
    first.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [10, 10, 100, 30],
          Dest: dest,
        }),
      ),
    );
  }
  return doc.save({ updateFieldAppearances: false });
};

describe("import chooses the direct path before compatibility fallbacks", () => {
  it("resolves 100 explicit page references without worker round trips", async () => {
    const service = worker();
    const result = await loadPDF(await linksPdf("explicit"), {
      workerService: service as unknown as PDFWorkerService,
    });
    try {
      expect(result.annotations).toHaveLength(100);
      expect(result.annotations.every((a) => a.linkDestPageIndex === 1)).toBe(
        true,
      );
      expect(service.resolveDest).not.toHaveBeenCalled();
    } finally {
      result.dispose();
    }
  });

  it.each([1, null])(
    "resolves a repeated named destination once (result=%s)",
    async (destination) => {
      const service = worker(destination);
      const result = await loadPDF(await linksPdf("named"), {
        workerService: service as unknown as PDFWorkerService,
      });
      try {
        expect(service.resolveDest).toHaveBeenCalledTimes(1);
        expect(result.annotations).toHaveLength(destination === null ? 0 : 100);
      } finally {
        result.dispose();
      }
    },
  );

  it("does not reuse named destination results between documents", async () => {
    const bytes = await linksPdf("named", 2);
    const firstService = worker(0);
    const secondService = worker(1);
    const first = await loadPDF(bytes, {
      workerService: firstService as unknown as PDFWorkerService,
    });
    const second = await loadPDF(bytes, {
      workerService: secondService as unknown as PDFWorkerService,
    });
    try {
      expect(first.annotations[0].linkDestPageIndex).toBe(0);
      expect(second.annotations[0].linkDestPageIndex).toBe(1);
      expect(firstService.resolveDest).toHaveBeenCalledTimes(1);
      expect(secondService.resolveDest).toHaveBeenCalledTimes(1);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it("does not guess a one-based page number for an out-of-range destination", async () => {
    const service = worker(null);
    const result = await loadPDF(await linksPdf("invalid", 1), {
      workerService: service as unknown as PDFWorkerService,
    });
    try {
      expect(result.annotations).toHaveLength(0);
    } finally {
      result.dispose();
    }
  });

  it("uses a native SVG stamp without extracting its appearance again", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const svg =
      "data:image/svg+xml;base64," +
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><rect width="80" height="20" fill="red"/></svg>',
      ).toString("base64");
    page.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Stamp",
          Rect: [10, 10, 90, 30],
          [PDF_CUSTOM_KEYS.stampSourceSvgData]: PDFString.of(svg),
        }),
      ),
    );
    const extract = vi.spyOn(stampVector, "extractStampSvgDataFromAppearance");
    const service = worker();
    const result = await loadPDF(await doc.save(), {
      workerService: service as unknown as PDFWorkerService,
    });
    try {
      expect(result.annotations).toHaveLength(1);
      expect(extract).not.toHaveBeenCalled();
      expect(service.renderPageImage).not.toHaveBeenCalled();
      expect(result.annotations[0].stamp?.image?.dataUrl).toBe(svg);
    } finally {
      result.dispose();
    }
  });
});
