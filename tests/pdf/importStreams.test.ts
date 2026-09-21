import { afterEach, describe, expect, it, vi } from "vitest";
import { deflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
} from "@cantoo/pdf-lib";
import {
  createPdfStreamTextReader,
  decodePdfStreamBytes,
  decodePdfStreamToText,
} from "@/services/pdfService/lib/pdf-import-utils";
import * as streamUtils from "@/services/pdfService/lib/pdf-import-utils";
import { ensurePdfEmbeddedFontLoaded } from "@/services/pdfService/lib/embedded-fonts";

const fontSetDescriptor = Object.getOwnPropertyDescriptor(document, "fonts");
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (fontSetDescriptor)
    Object.defineProperty(document, "fonts", fontSetDescriptor);
  else Reflect.deleteProperty(document, "fonts");
});

const text = "q\n2 w\n10 10 80 20 re\nS\nQ";

describe("declared PDF stream decoding", () => {
  it.each(["plain", "flate", "hex-flate", "run-length"])(
    "decodes %s without browser decompression",
    async (encoding) => {
      const doc = await PDFDocument.create();
      const bytes = new Uint8Array(new TextEncoder().encode(text));
      const stream =
        encoding === "plain"
          ? doc.context.stream(bytes)
          : encoding === "flate"
            ? doc.context.flateStream(bytes)
            : encoding === "hex-flate"
              ? doc.context.stream(`${deflateSync(bytes).toString("hex")}>`, {
                  Filter: ["ASCIIHexDecode", "FlateDecode"],
                })
              : doc.context.stream(
                  new Uint8Array([bytes.length - 1, ...bytes, 128]),
                  { Filter: "RunLengthDecode" },
                );
      vi.stubGlobal("DecompressionStream", undefined);
      await expect(decodePdfStreamToText(stream)).resolves.toBe(text);
    },
  );

  it.each(["DCTDecode", "FlateDecode"])(
    "does not interpret corrupt/unsupported %s bytes as text",
    async (filter) => {
      const doc = await PDFDocument.create();
      const stream = doc.context.stream(text, { Filter: filter });
      expect(decodePdfStreamBytes(stream)).toBeUndefined();
      await expect(decodePdfStreamToText(stream)).resolves.toBe("");
    },
  );

  it("shares decoding within an import but not across independent readers", async () => {
    const doc = await PDFDocument.create();
    const stream = doc.context.flateStream(text);
    const bytes = stream.contents;
    const reads = vi.fn(() => bytes);
    Object.defineProperty(stream, "contents", { get: reads });
    const read = createPdfStreamTextReader();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => read(stream)),
    );
    expect(results.every((value) => value === text)).toBe(true);
    expect(reads).toHaveBeenCalledTimes(1);
    await createPdfStreamTextReader()(stream);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it("keeps source encryption transforms when decoding an encrypted PDF", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    page.node.set(
      PDFName.of("Contents"),
      doc.context.register(doc.context.flateStream(text)),
    );
    doc.encrypt({ userPassword: "open", ownerPassword: "owner" });
    const reopened = await PDFDocument.load(await doc.save(), {
      password: "open",
    });
    const contents = reopened.getPage(0).node.lookup(PDFName.of("Contents"));
    const stream = contents instanceof PDFArray ? contents.lookup(0) : contents;
    expect(stream).toBeInstanceOf(PDFStream);
    await expect(decodePdfStreamToText(stream as PDFRawStream)).resolves.toBe(
      text,
    );
  });
});

describe("embedded font cache", () => {
  const setup = async (filter?: string) => {
    const faces = new Set<FontFace>();
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: faces,
    });
    const load = vi.fn(async function (this: FontFace) {
      return this;
    });
    vi.stubGlobal(
      "FontFace",
      class {
        constructor(
          public family: string,
          public source: ArrayBuffer,
        ) {}
        load = load;
      },
    );
    const doc = await PDFDocument.create();
    const bytes = new Uint8Array([0, 1, 0, 0, 65, 66, 67]);
    const stream = filter
      ? doc.context.stream(bytes, { Filter: filter })
      : doc.context.flateStream(bytes);
    const font = doc.context.obj({
      Subtype: "TrueType",
      FontDescriptor: { FontFile2: stream },
    });
    return { font, faces, load };
  };

  it("does not decompress a cached or pending font for each control", async () => {
    const { font, faces, load } = await setup();
    const decode = vi.spyOn(streamUtils, "decodePdfStreamBytes");
    const cache = new Map<string, Promise<string | undefined>>();
    const loadedFaces = new Set<FontFace>();
    const families = await Promise.all(
      Array.from({ length: 100 }, () =>
        ensurePdfEmbeddedFontLoaded(font, "TestFont", cache, loadedFaces),
      ),
    );
    expect(new Set(families).size).toBe(1);
    expect(families[0]).toMatch(/^pdf-/);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(faces.size).toBe(1);
    expect(loadedFaces.size).toBe(1);
  });

  it("shares unavailable fonts without attempting invalid FontFace loads", async () => {
    const { font, load } = await setup("DCTDecode");
    const decode = vi.spyOn(streamUtils, "decodePdfStreamBytes");
    const cache = new Map<string, Promise<string | undefined>>();
    for (let index = 0; index < 20; index++) {
      await expect(
        ensurePdfEmbeddedFontLoaded(font, "Unavailable", cache),
      ).resolves.toBeUndefined();
    }
    expect(decode).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
  });
});
