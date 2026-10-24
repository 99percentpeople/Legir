import type { Annotation, FormField } from "@/types";

/** Menu placement in PDF coordinates, tied to the page that opened the menu. */
export type ControlPasteTarget = { pageId: string; x: number; y: number };

/** Self-contained controls; PDF object references never travel on the clipboard. */
export type ControlClipboard = {
  version: 1;
  sourceDocumentId: string;
} & (
  | { type: "field"; data: FormField }
  | { type: "annotation"; data: Annotation }
);
