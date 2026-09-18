import {
  FieldType,
  type Annotation,
  type FormField,
  type PDFOutlineItem,
} from "@/types";
import { PAGE_TITLES, QUOTE, type DemoFields, type DemoState } from "./types";
import type { DemoCopy } from "./copy";

// Adapters for the application's actual sidebar components. No PDF services or
// editor store are mounted; all commands return to the demo's local reducer.
export const DEMO_ANNOTATION_ID = "demo-highlight";
export const DEMO_OUTLINE: PDFOutlineItem[] = PAGE_TITLES.map(
  (title, pageIndex) => ({
    title,
    pageIndex,
    items: [],
  }),
);
export const DEMO_FIELD_IDS = ["name", "email", "note", "reviewed"] as const;
export function isDemoField(id: string): id is keyof DemoFields {
  return DEMO_FIELD_IDS.some((field) => field === id);
}
export function demoFormFields(state: DemoState, copy: DemoCopy): FormField[] {
  return DEMO_FIELD_IDS.map((id, index) => ({
    id,
    pageIndex: 1,
    type: id === "reviewed" ? FieldType.CHECKBOX : FieldType.TEXT,
    name: copy[id],
    rect: { x: 52, y: 220 + index * 64, width: 491, height: 32 },
    value: typeof state.fields[id] === "string" ? state.fields[id] : undefined,
    isChecked: id === "reviewed" ? state.fields.reviewed : undefined,
    multiline: id === "note",
  }));
}
export function demoAnnotations(state: DemoState): Annotation[] {
  return state.highlighted
    ? [
        {
          id: DEMO_ANNOTATION_ID,
          pageIndex: 0,
          type: "highlight",
          highlightedText: QUOTE,
          text: state.annotationText,
          author: "Reader",
          color: state.highlightColor,
          opacity: 0.4,
          replies: state.replies,
        },
      ]
    : [];
}
