import type { PdfHydrationServices } from "../host.js";
import { PDFDocument } from "@legir/pdfium/authoring";
import {
  FormField,
  PageData,
  PDFDocumentPermissions,
  PDFMetadata,
  PDFOutlineItem,
  Annotation,
  PreservedSourceAnnotationRef,
} from "@legir/pdf-model";

export type LoadedPdfDocument = {
  pdfBytes: Uint8Array;
  pages: PageData[];
  fields: FormField[];
  annotations: Annotation[];
  preservedSourceAnnotations: PreservedSourceAnnotationRef[];
  metadata: PDFMetadata;
  documentPermissions: PDFDocumentPermissions;
  outline: PDFOutlineItem[];
  openPassword?: string;
  dispose: () => void;
};

export type ReadablePdfDocument = Omit<
  LoadedPdfDocument,
  | "fields"
  | "annotations"
  | "preservedSourceAnnotations"
  | "documentPermissions"
  | "outline"
> & {
  fields: [];
  annotations: [];
  preservedSourceAnnotations: [];
  documentPermissions: null;
  outline: [];
};

export type LoadPDFInternalOptions = {
  /** A transient import donor in the existing document worker. */
  importId?: string;
  pageIndexes?: number[];
  getImportPageIndexes?: () => number[] | undefined;
  editingDocument?: PDFDocument;
  fontCatalog?: { families: string[]; aliases: Record<string, string> };
  collectFont?: (family: string, bytes: Uint8Array) => void;
  password?: string | null;
  workerService?: PdfHydrationServices;
  signal?: AbortSignal;
  onReadable?: (document: ReadablePdfDocument) => void;
  waitForHydrationStart?: () => Promise<void>;
};
