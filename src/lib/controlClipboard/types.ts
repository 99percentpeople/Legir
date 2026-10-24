import type { Annotation, FormField } from "@/types";

/** Self-contained controls; PDF object references never travel on the clipboard. */
export type ControlClipboard = {
  version: 1;
  sourceDocumentId: string;
} & (
  | { type: "field"; data: FormField }
  | { type: "annotation"; data: Annotation }
);
