import type { LoadedPdfDocument } from "../documentPipeline";
import type { PdfEngineRequest, PdfEngineResponse } from "./types";
import type { Annotation, FormField, PDFMetadata } from "@/types";

export type ExportPdfOptions = Omit<
  NonNullable<
    Parameters<(typeof import("../documentPipeline"))["exportPDF"]>[5]
  >,
  "editingDocument" | "resolveSource"
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
  contentOperation: {
    input: { request: PdfEngineRequest };
    output: Extract<PdfEngineResponse, { ok: true }>["result"];
  };
  inspectDocument: {
    input: object;
    output: Pick<LoadedPdfDocument, "pages" | "metadata">;
  };
  parseDocument: {
    input: {
      fontCatalog?: { families: string[]; aliases: Record<string, string> };
    };
    output: ParsedPdfModels;
  };
  exportDocument: { input: ExportPdfRequest; output: Uint8Array };
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
    };
  };
};
