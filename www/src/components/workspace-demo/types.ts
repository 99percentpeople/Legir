import type { PreviewMode } from "../../content/types";
import type {
  Tool as EditorTool,
  PageLayoutMode,
  PageFlowDirection,
  AnnotationReply,
} from "@/types";
import { ANNOTATION_STYLES } from "@/constants";
import type { AiChatTokenUsageSummary } from "@/services/ai/chat/types";

export const DOCUMENT_TITLE = "reading-notes.pdf";
export const QUOTE =
  "Reading is not just taking in words. It is making space to think.";
export const INTRO = "Read carefully. Leave a note. Keep what matters.";
export const PARAGRAPH =
  "The best ideas rarely arrive when we rush. They take shape in the margins, between a sentence worth keeping and a question worth asking.";
export const PAGE_TITLES = [
  "Make room for a good idea.",
  "A few notes, before you go.",
  "Keep the thought going.",
];
export type SidebarView =
  | "thumbnails"
  | "outline"
  | "annotations"
  | "fields"
  | "search";
export type Tool = EditorTool;
export type AnswerKind = "summary" | "actions" | "selection" | "fallback";
export type DemoTokenStats = {
  tokenUsage: AiChatTokenUsageSummary;
  contextTokens: number;
};
export type DemoTokenPlan = {
  previousUsage: AiChatTokenUsageSummary;
  inputTokens: number;
  reasoning: boolean;
};
export type TranslationId = "quote" | "intro" | "paragraph";
export type DemoFields = {
  name: string;
  email: string;
  note: string;
  reviewed: boolean;
};
type DocumentSnapshot = {
  fields: DemoFields;
  highlighted: boolean;
  highlightColor: string;
  annotationText: string;
  replies: AnnotationReply[];
};
export type DemoState = DocumentSnapshot & {
  page: number;
  navigationToken: number;
  selectedAnnotation: boolean;
  zoom: number;
  fit: "screen" | "width" | null;
  editorMode: "annotation" | "form";
  sidebar: boolean;
  sidebarView: SidebarView;
  panel: "ai" | "document" | "page_translate" | "properties" | null;
  translationOpen: boolean;
  translationToken: number;
  tool: Tool;
  selection: string;
  selectedField: keyof DemoFields | null;
  layout: PageLayoutMode;
  flow: PageFlowDirection;
  past: DocumentSnapshot[];
  future: DocumentSnapshot[];
  dirty: boolean;
};
export const initialDemoState: DemoState = {
  page: 1,
  navigationToken: 0,
  selectedAnnotation: false,
  annotationText: "A useful reminder: leave room for your own thoughts.",
  replies: [],
  zoom: 100,
  fit: "width",
  editorMode: "annotation",
  sidebar: true,
  sidebarView: "thumbnails",
  panel: null,
  translationOpen: false,
  translationToken: 0,
  highlighted: false,
  highlightColor: ANNOTATION_STYLES.highlight.color,
  tool: "select",
  fields: {
    name: "Alex Chen",
    email: "reader@example.com",
    note: "",
    reviewed: false,
  },
  selection: QUOTE,
  selectedField: null,
  layout: "single",
  flow: "vertical",
  past: [],
  future: [],
  dirty: false,
};
export type DemoAction =
  | { type: "mode"; mode: PreviewMode }
  | { type: "editor-mode"; mode: DemoState["editorMode"] }
  | { type: "page"; page: number }
  | { type: "visible-page"; page: number }
  | { type: "close-panels" }
  | { type: "select-annotation" }
  | { type: "annotation-text"; text: string }
  | { type: "annotation-replies"; replies: AnnotationReply[] }
  | { type: "zoom"; delta: number }
  | { type: "scale"; zoom: number }
  | { type: "fit"; fit?: "screen" | "width" }
  | { type: "sidebar"; view?: SidebarView }
  | { type: "hide-sidebar" }
  | { type: "panel"; panel: DemoState["panel"] }
  | { type: "translate"; open: boolean; auto?: boolean }
  | { type: "highlight" }
  | { type: "highlight-color"; color: string }
  | { type: "tool"; tool: Tool }
  | { type: "field"; field: keyof DemoFields; value: string | boolean }
  | { type: "select-field"; field: keyof DemoFields }
  | { type: "selection"; text: string }
  | { type: "layout"; layout: PageLayoutMode }
  | { type: "flow"; flow: PageFlowDirection }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "save" }
  | { type: "reset" };
const snapshot = ({
  fields,
  highlighted,
  highlightColor,
  annotationText,
  replies,
}: DemoState): DocumentSnapshot => ({
  fields,
  highlighted,
  highlightColor,
  annotationText,
  replies,
});
function record(
  state: DemoState,
  changes: Partial<DocumentSnapshot>,
): DemoState {
  return {
    ...state,
    ...changes,
    past: [...state.past.slice(-29), snapshot(state)],
    future: [],
    dirty: true,
  };
}
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "mode":
      return {
        ...state,
        page: action.mode === "forms" ? 2 : 1,
        navigationToken: state.navigationToken + 1,
        selectedAnnotation: false,
        sidebar: true,
        fit: "width",
        editorMode: action.mode === "forms" ? "form" : "annotation",
        panel: action.mode === "ai" ? "ai" : null,
        translationOpen: action.mode === "translate",
        translationToken:
          state.translationToken + (action.mode === "translate" ? 1 : 0),
        sidebarView:
          action.mode === "annotate"
            ? "annotations"
            : action.mode === "forms"
              ? "fields"
              : "thumbnails",
        tool: action.mode === "annotate" ? "draw_highlight" : "select",
        highlighted: state.highlighted || action.mode === "annotate",
        selection: action.mode === "translate" ? QUOTE : state.selection,
        selectedField: null,
      };
    case "editor-mode":
      return {
        ...state,
        editorMode: action.mode,
        tool: "select",
        selectedField: null,
      };
    case "page":
      return {
        ...state,
        page: Math.min(3, Math.max(1, action.page)),
        navigationToken: state.navigationToken + 1,
        selectedField: null,
      };
    case "visible-page": {
      const page = Math.min(3, Math.max(1, action.page));
      return page === state.page ? state : { ...state, page };
    }
    case "close-panels":
      return { ...state, sidebar: false, panel: null };
    case "select-annotation":
      return {
        ...state,
        page: 1,
        selectedAnnotation: true,
        navigationToken: state.navigationToken + 1,
      };
    case "annotation-text":
      return record(state, { annotationText: action.text.slice(0, 2000) });
    case "annotation-replies":
      return record(state, { replies: action.replies.slice(-30) });
    case "zoom":
      return {
        ...state,
        fit: null,
        zoom: Math.min(200, Math.max(25, state.zoom + action.delta)),
      };
    case "scale":
      return { ...state, zoom: Math.min(200, Math.max(10, action.zoom)) };
    case "fit":
      return { ...state, fit: action.fit ?? "screen" };
    case "sidebar":
      return action.view
        ? { ...state, sidebar: true, sidebarView: action.view }
        : { ...state, sidebar: !state.sidebar };
    case "hide-sidebar":
      return { ...state, sidebar: false };
    case "panel":
      return { ...state, panel: action.panel };
    case "translate":
      return {
        ...state,
        page: action.open ? 1 : state.page,
        selection: action.open ? QUOTE : state.selection,
        translationOpen: action.open,
        translationToken: state.translationToken + (action.auto ? 1 : 0),
      };
    case "highlight":
      return record(state, { highlighted: !state.highlighted });
    case "highlight-color":
      return record(state, { highlightColor: action.color });
    case "tool":
      return { ...state, tool: action.tool };
    case "selection":
      return { ...state, selection: action.text.trim().slice(0, 600) || QUOTE };
    case "field": {
      if (action.field === "reviewed")
        return typeof action.value === "boolean"
          ? record(state, {
              fields: { ...state.fields, reviewed: action.value },
            })
          : state;
      return typeof action.value === "string"
        ? record(state, {
            fields: {
              ...state.fields,
              [action.field]: action.value.slice(0, 500),
            },
          })
        : state;
    }
    case "select-field":
      return {
        ...state,
        page: 2,
        selectedField: action.field,
        navigationToken: state.navigationToken + 1,
      };
    case "layout":
      return { ...state, layout: action.layout, fit: "width" };
    case "flow":
      return { ...state, flow: action.flow };
    case "undo": {
      const previous = state.past.at(-1);
      return previous
        ? {
            ...state,
            ...previous,
            past: state.past.slice(0, -1),
            future: [snapshot(state), ...state.future],
            dirty: true,
          }
        : state;
    }
    case "redo": {
      const next = state.future[0];
      return next
        ? {
            ...state,
            ...next,
            past: [...state.past, snapshot(state)],
            future: state.future.slice(1),
            dirty: true,
          }
        : state;
    }
    case "save":
      return { ...state, dirty: false };
    case "reset":
      return initialDemoState;
  }
}
export function getTranslationId(text: string): TranslationId | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized === QUOTE) return "quote";
  if (normalized === INTRO) return "intro";
  if (normalized === PARAGRAPH) return "paragraph";
  return null;
}
