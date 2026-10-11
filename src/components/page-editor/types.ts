import type { LoadedPdfDocument } from "@/services/pdfService";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import type { PageData } from "@/types";

export type BlankPageSize = "same" | "a4" | "a3";

export type PageAction =
  | "clockwise"
  | "counterclockwise"
  | "duplicate"
  | "delete";

export type PageSelectionIntent =
  | "single"
  | "toggle"
  | "range"
  | "addRange"
  | "all"
  | "clear";

export type PageDragPreviewData = {
  page: PageData;
  image?: string;
  count: number;
  bounds?: { width: number; height: number };
  stack: { page: PageData; image?: string }[];
};

export type ImportedDocument = {
  document: LoadedPdfDocument;
  worker: PDFWorkerService;
  filename: string;
};

export type InsertPosition =
  | "start"
  | "end"
  | "before"
  | "after"
  | "before_page"
  | "after_page";
