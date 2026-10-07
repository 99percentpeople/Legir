import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFStream,
  degrees,
} from "@cantoo/pdf-lib";
import { exportPDF } from "@/services/pdfService";
import {
  getImageExportPixelSize,
  prepareStampImageForPdf,
} from "@/services/pdfService/lib/image-export";
import { normalizeImageCompression } from "@/lib/imageCompression";
import { initialState, mergeEditorOptions } from "@/store/helpers";
import type { Annotation, ImageCompressionOptions } from "@/types";

// Semitransparent PNG fixtures: 400 x 200 source, 150 x 75 downsample.
const originalPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAZAAAADICAYAAADGFbfiAAAC4ElEQVR4nO3VMQ0AIQDAQOQg5yUhD1lo+C6E5Ibbu3Xsby4A+GvcDgDgTQYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAYCQGIgACQGAkBiIAAkBgJAYiAAJAfwHAAOzo9DBgAAAABJRU5ErkJggg==";
const resizedPng = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAJYAAABLCAYAAACSoX4TAAAA30lEQVR4nO3SMQ0AIQDAQOQg5yUhD1mY+IaE3HB7h479zQV/G7cDeJOxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBwNYev17WRF2AAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);

const draw = vi.fn();
const encode = vi.fn();
const close = vi.fn();
const canvases: FakeCanvas[] = [];
class FakeCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {
    canvases.push(this);
  }
  getContext() {
    return { drawImage: draw };
  }
  convertToBlob(options: { type: string }) {
    return encode(options);
  }
}
const dpi150: ImageCompressionOptions = { mode: "dpi", dpi: 150 };
const placement = { width: 72, height: 36 };

beforeEach(() => {
  canvases.length = 0;
  draw.mockReset();
  encode.mockReset();
  close.mockReset();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 400, height: 200, close })),
  );
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
  encode.mockImplementation(async ({ type }) => ({
    type,
    arrayBuffer: async () => resizedPng.buffer,
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("image DPI policy", () => {
  it("restores old preferences with original resolution as the default", () => {
    const legacy = { ...initialState.options };
    delete (legacy as Partial<typeof legacy>).imageCompression;
    expect(mergeEditorOptions(legacy).imageCompression).toEqual({
      mode: "original",
      dpi: 150,
    });
    expect(
      mergeEditorOptions(initialState.options, { imageCompression: dpi150 })
        .imageCompression,
    ).toEqual(dpi150);
    expect(normalizeImageCompression({ mode: "dpi", dpi: NaN })).toEqual(
      dpi150,
    );
    expect(normalizeImageCompression({ mode: "dpi", dpi: Infinity })).toEqual(
      dpi150,
    );
  });

  it("uses physical page dimensions, limits sampling to the source and keeps aspect ratio", () => {
    expect(
      getImageExportPixelSize({ width: 4000, height: 2000 }, placement, dpi150),
    ).toEqual({ width: 150, height: 75 });
    expect(
      getImageExportPixelSize({ width: 40, height: 20 }, placement, dpi150),
    ).toEqual({ width: 40, height: 20 });
    expect(
      getImageExportPixelSize(
        { width: 4000, height: 2000 },
        { width: 144, height: 36 },
        dpi150,
      ),
    ).toEqual({ width: 300, height: 150 });
  });

  it.each(["image/png", "image/jpeg"])(
    "retains exact %s bytes without decoding in original mode",
    async (mimeType) => {
      const result = await prepareStampImageForPdf({
        dataUrl: `data:${mimeType};base64,AQID`,
        placement,
      });
      expect(result).toEqual({ bytes: new Uint8Array([1, 2, 3]), mimeType });
      expect(createImageBitmap).not.toHaveBeenCalled();
      expect(encode).not.toHaveBeenCalled();
    },
  );

  it("preserves PNG transparency and releases its bitmap and canvas", async () => {
    const result = await prepareStampImageForPdf({
      dataUrl: originalPng,
      placement,
      compression: dpi150,
    });
    expect(result.mimeType).toBe("image/png");
    expect(draw.mock.calls[0].slice(1)).toEqual([0, 0, 150, 75]);
    expect(encode).toHaveBeenCalledWith({ type: "image/png", quality: 0.9 });
    expect(close).toHaveBeenCalledOnce();
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 });
  });

  it("keeps JPEG encoding when reducing JPEG resolution", async () => {
    const result = await prepareStampImageForPdf({
      dataUrl: "data:image/jpeg;base64,AQID",
      placement,
      compression: dpi150,
    });
    expect(result.mimeType).toBe("image/jpeg");
    expect(encode).toHaveBeenCalledWith({ type: "image/jpeg", quality: 0.9 });
  });

  it("converts WebP at its native resolution in original mode", async () => {
    await prepareStampImageForPdf({
      dataUrl: "data:image/webp;base64,AQID",
      placement,
    });
    expect(draw.mock.calls[0].slice(1)).toEqual([0, 0, 400, 200]);
  });

  it("does not re-encode images below the target DPI", async () => {
    const result = await prepareStampImageForPdf({
      dataUrl: "data:image/png;base64,AQID",
      placement: { width: 720, height: 360 },
      compression: dpi150,
    });
    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(encode).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("retains exportable image data when compression fails", async () => {
    encode.mockRejectedValue(new Error("Canvas failed"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await prepareStampImageForPdf({
      dataUrl: "data:image/png;base64,AQID",
      placement,
      compression: dpi150,
    });
    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(close).toHaveBeenCalledOnce();
    expect(canvases[0].width).toBe(0);
  });
});

const stamp: Annotation = {
  id: "image",
  type: "stamp",
  pageIndex: 0,
  rect: { x: 20, y: 30, ...placement },
  stamp: {
    kind: "image",
    image: { dataUrl: originalPng, intrinsicSize: { width: 400, height: 200 } },
    appearance: { frame: "plain" },
  },
};

const embeddedImage = (doc: PDFDocument) => {
  const annotation = doc.getPage(0).node.Annots()!.lookup(0) as PDFDict;
  const appearance = annotation
    .lookup(PDFName.of("AP"), PDFDict)
    .lookup(PDFName.of("N")) as PDFStream;
  const resources = appearance.dict.lookup(PDFName.of("Resources"), PDFDict);
  return resources
    .lookup(PDFName.of("XObject"), PDFDict)
    .lookup(PDFName.of("Im0")) as PDFStream;
};

describe("PDF image stamp export", () => {
  it.each([0, 90])(
    "writes the requested pixel dimensions and alpha mask on a page rotated %s degrees",
    async (rotation) => {
      const source = await PDFDocument.create();
      const page = source.addPage([600, 800]);
      page.setRotation(degrees(rotation));
      // A larger UserUnit changes PDF coordinates, not physical DPI.
      page.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
      const output = await exportPDF(
        await source.save(),
        [],
        undefined,
        [stamp],
        undefined,
        { imageCompression: dpi150 },
      );
      const doc = await PDFDocument.load(output);
      const image = embeddedImage(doc);
      expect(image.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber()).toBe(
        150,
      );
      expect(
        image.dict.lookup(PDFName.of("Height"), PDFNumber).asNumber(),
      ).toBe(75);
      expect(image.dict.has(PDFName.of("SMask"))).toBe(true);
      expect(draw.mock.calls[0].slice(1)).toEqual([0, 0, 150, 75]);
      expect(stamp.stamp?.image?.dataUrl).toBe(originalPng);
      expect(stamp.stamp?.image?.intrinsicSize).toEqual({
        width: 400,
        height: 200,
      });
    },
  );

  it("keeps the original embedded pixel dimensions by default", async () => {
    const source = await PDFDocument.create();
    source.addPage([600, 800]);
    const output = await exportPDF(await source.save(), [], undefined, [stamp]);
    const image = embeddedImage(await PDFDocument.load(output));
    expect(image.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber()).toBe(
      400,
    );
    expect(image.dict.lookup(PDFName.of("Height"), PDFNumber).asNumber()).toBe(
      200,
    );
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("keeps SVG stamps as vectors even when DPI compression is enabled", async () => {
    const source = await PDFDocument.create();
    source.addPage([600, 800]);
    const svg =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="red" /></svg>',
      );
    await exportPDF(
      await source.save(),
      [],
      undefined,
      [
        {
          ...stamp,
          stamp: {
            ...stamp.stamp!,
            image: { dataUrl: svg, intrinsicSize: { width: 400, height: 200 } },
          },
        },
      ],
      undefined,
      { imageCompression: dpi150 },
    );
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
  });
});
