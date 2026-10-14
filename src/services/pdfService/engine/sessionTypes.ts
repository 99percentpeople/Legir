import type { LoadedPdfDocument } from "../documentPipeline";
import type { PdfEngineRequest, PdfEngineResponse } from "./types";
import type { Annotation, FormField, PDFMetadata } from "@/types";

export type ExportPdfOptions = Omit<
  NonNullable<
    Parameters<(typeof import("../documentPipeline"))["exportPDF"]>[5]
  >,
  | "editingDocument"
  | "resolveSource"
  | "signal"
  | "writeChunk"
  | "writeBlob"
  | "onSavedDocument"
>;
export type ExportPdfRequest = {
  fields: FormField[];
  metadata?: PDFMetadata;
  annotations: Annotation[];
  customFont?: { bytes?: Uint8Array; name?: string };
  options?: ExportPdfOptions;
};
export type ParsedPdfModels = Omit<
  LoadedPdfDocument,
  "pdfBytes" | "dispose" | "openPassword"
> & {
  fonts: { family: string; bytes: Uint8Array }[];
};
export type DocumentCommands = {
  warmup: { input: object; output: boolean };
  addBlankSource: {
    input: { docId: string; width: number; height: number };
    output: boolean;
  };
  commitImport: {
    input: { docId: string; pageIndexes: number[] };
    output: boolean;
  };
  contentOperation: {
    input: { request: PdfEngineRequest };
    output: Extract<PdfEngineResponse, { ok: true }>["result"];
  };
  inspectDocument: {
    input: { docId?: string };
    output: Pick<LoadedPdfDocument, "pages" | "metadata">;
  };
  parseDocument: {
    input: {
      docId?: string;
      pageIndexes?: number[];
      fontCatalog?: { families: string[]; aliases: Record<string, string> };
    };
    output: ParsedPdfModels;
  };
  exportDocument: { input: ExportPdfRequest; output: Uint8Array };
  exportDocumentBlob: {
    input: ExportPdfRequest;
    output: { blob: Blob; preview?: { bytes: Uint8Array; mimeType: string } };
  };
  documentStats: {
    input: object;
    output: {
      nativeDocuments: number;
      peakNativeDocuments: number;
      sources: number;
      wasmCapacityBytes: number;
      largeImageCache: ReturnType<
        import("@legir/pdfium").PDFium["largeImageCache"]
      >;
      scanCanvas?: import("@legir/pdfium").ScanCanvasStats;
    };
  };
};
