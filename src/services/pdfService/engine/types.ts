/** Content-engine coordinates use PDF user space, including the original page
 * origin and UserUnit. They do not depend on viewer zoom or temporary rotation. */
export type PdfPoint = [number, number];
export type PdfMatrix = [number, number, number, number, number, number];
/** Upper-left, upper-right, lower-left, lower-right in text reading order. */
export type PdfQuad = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface PdfEngineSource {
  bytes: Uint8Array;
  password?: string;
}

export interface PdfTextRegion {
  pageIndex: number;
  quad: PdfQuad;
}

export interface PdfTextGlyph {
  text: string;
  origin: PdfPoint;
  quad: PdfQuad;
  fontName: string;
  fontSize: number;
  color: number[];
}

export interface PdfPageText {
  pageIndex: number;
  text: string;
  pdfToPage: PdfMatrix;
  lines: { writingMode: number; glyphs: PdfTextGlyph[] }[];
}

/** A model can return pixel coordinates; pixelToPdf maps them back to the PDF.
 * Recognition, language/model selection and credentials belong to the OCR service. */
export interface PdfOcrImage {
  pageIndex: number;
  bytes: Uint8Array;
  mimeType: "image/png";
  width: number;
  height: number;
  pixelToPdf: PdfMatrix;
}

export type PdfEngineOperations = {
  readDocument: { input: PdfEngineSource; output: PdfObjectGraph };
  writeDocument: {
    input: { graph: PdfObjectGraph; security?: PdfEncryption };
    output: Uint8Array;
  };
  verifyOwnerPassword: {
    input: PdfEngineSource & { password: string };
    output: { encrypted: boolean; owner: boolean };
  };
  redactText: {
    input: PdfEngineSource & { regions: PdfTextRegion[] };
    output: Uint8Array;
  };
  extractText: {
    input: PdfEngineSource & { pageIndex: number };
    output: PdfPageText;
  };
  renderOcrImage: {
    input: PdfEngineSource & {
      pageIndex: number;
      dpi?: number;
      maxPixels?: number;
    };
    output: PdfOcrImage;
  };
};

export type PdfEngineRequest = {
  [K in keyof PdfEngineOperations]: PdfEngineOperations[K]["input"] & {
    operation: K;
  };
}[keyof PdfEngineOperations];

export type PdfEngineResponse =
  | {
      ok: true;
      result: PdfEngineOperations[keyof PdfEngineOperations]["output"];
    }
  | { ok: false; error: string };

/** Lossless, transferable PDF object graph. Names and byte strings are distinct;
 * indirect references are never expanded, preserving cycles and shared resources. */
export type PdfObjectValue =
  | null
  | boolean
  | number
  | { name: string } // Escaped PDF name spelling, without its leading slash.
  | { string: Uint8Array }
  | { ref: number; generation: number }
  | { array: PdfObjectValue[] }
  | { dict: [string, PdfObjectValue][]; stream?: Uint8Array };

export interface PdfObjectGraph {
  version: number;
  objects: { number: number; generation: number; value: PdfObjectValue }[];
  trailer: [string, PdfObjectValue][];
}

export interface PdfEncryption {
  userPassword: string;
  ownerPassword: string;
  /** Standard PDF /P permission bits. */
  permissions?: number;
}
