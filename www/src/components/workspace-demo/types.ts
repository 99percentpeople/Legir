import type { PreviewMode } from "../../content/types";
import type {
  Tool as EditorTool,
  PageLayoutMode,
  PageFlowDirection,
  AnnotationReply,
} from "@/types";
import {
  ANNOTATION_STYLES,
  MIN_PAGE_THUMBNAIL_SCALE,
  MAX_PAGE_THUMBNAIL_SCALE,
} from "@/constants";
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
export type DemoPage = {
  id: string;
  sourcePage: number | null;
  rotation: number;
};
type DocumentSnapshot = {
  pages: DemoPage[];
  selectedPageIds: string[];
  page: number;
  fields: DemoFields;
  highlighted: boolean;
  highlightColor: string;
  annotationText: string;
  replies: AnnotationReply[];
};
export type DemoState = DocumentSnapshot & {
  nextPageId: number;
  showSelection: boolean;
  thumbnailScale: number;
  navigationToken: number;
  selectedAnnotation: boolean;
  zoom: number;
  fit: "screen" | "width" | null;
  editorMode: "annotation" | "form" | "pages";
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
  pages: [1, 2, 3].map((sourcePage) => ({
    id: `sample-${sourcePage}`,
    sourcePage,
    rotation: 0,
  })),
  selectedPageIds: [],
  nextPageId: 4,
  showSelection: false,
  thumbnailScale: 1,
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
  | { type: "scene"; mode: PreviewMode }
  | {
      type: "select-pages";
      id?: string;
      intent: "single" | "all" | "clear";
    }
  | { type: "rotate-pages"; ids: string[]; delta: number }
  | { type: "move-pages"; ids: string[]; beforeIndex: number }
  | { type: "duplicate-pages"; ids: string[] }
  | { type: "delete-pages"; ids: string[] }
  | { type: "blank-page" }
  | { type: "show-selection"; open: boolean }
  | { type: "thumbnail-scale"; scale: number }
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
  | {
      type: "field";
      field: keyof DemoFields;
      value: string | boolean;
    }
  | { type: "select-field"; field: keyof DemoFields }
  | { type: "selection"; text: string }
  | { type: "layout"; layout: PageLayoutMode }
  | { type: "flow"; flow: PageFlowDirection }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "save" }
  | { type: "reset" };
const snapshot = ({
  pages,
  selectedPageIds,
  page,
  fields,
  highlighted,
  highlightColor,
  annotationText,
  replies,
}: DemoState): DocumentSnapshot => ({
  pages,
  selectedPageIds,
  page,
  fields,
  highlighted,
  highlightColor,
  annotationText,
  replies,
});
export function sourcePageNumber(state: DemoState, sourcePage: number) {
  const index = state.pages.findIndex((page) => page.sourcePage === sourcePage);
  return index < 0 ? 1 : index + 1;
}

export function moveDemoPages(
  pages: DemoPage[],
  ids: string[],
  beforeIndex: number,
) {
  const selected = new Set(ids);
  const moving = pages.filter((page) => selected.has(page.id));
  const remaining = pages.filter((page) => !selected.has(page.id));
  const position = pages
    .slice(0, beforeIndex)
    .filter((page) => !selected.has(page.id)).length;
  return [
    ...remaining.slice(0, position),
    ...moving,
    ...remaining.slice(position),
  ];
}

function recordPages(
  state: DemoState,
  pages: DemoPage[],
  selectedPageIds = state.selectedPageIds,
) {
  if (
    pages.every((page, index) => page === state.pages[index]) &&
    pages.length === state.pages.length
  )
    return state;
  const activeId = state.pages[state.page - 1]?.id;
  const activeIndex = pages.findIndex((page) => page.id === activeId);
  return {
    ...record(state, {
      pages,
      selectedPageIds: selectedPageIds.filter((id) =>
        pages.some((page) => page.id === id),
      ),
      page:
        activeIndex < 0 ? Math.min(state.page, pages.length) : activeIndex + 1,
    }),
    navigationToken: state.navigationToken + 1,
  };
}
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
    case "select-pages": {
      if (action.intent === "all")
        return {
          ...state,
          selectedPageIds: state.pages.map((page) => page.id),
        };
      if (action.intent === "clear") return { ...state, selectedPageIds: [] };
      const id = action.id;
      return id && state.pages.some((page) => page.id === id)
        ? { ...state, selectedPageIds: [id] }
        : state;
    }
    case "rotate-pages":
      return recordPages(
        state,
        state.pages.map((page) =>
          action.ids.includes(page.id)
            ? { ...page, rotation: (page.rotation + action.delta + 360) % 360 }
            : page,
        ),
      );
    case "move-pages":
      return recordPages(
        state,
        moveDemoPages(state.pages, action.ids, action.beforeIndex),
      );
    case "duplicate-pages": {
      if (state.pages.length >= 24) return state;
      let nextPageId = state.nextPageId;
      const pages = state.pages.flatMap((page) =>
        action.ids.includes(page.id)
          ? [page, { ...page, id: `sample-${nextPageId++}` }]
          : [page],
      );
      return { ...recordPages(state, pages), nextPageId };
    }
    case "delete-pages": {
      const pages = state.pages.filter((page) => !action.ids.includes(page.id));
      return pages.length ? recordPages(state, pages) : state;
    }
    case "blank-page": {
      if (state.pages.length >= 24) return state;
      const id = `sample-${state.nextPageId}`;
      return {
        ...recordPages(
          state,
          [...state.pages, { id, sourcePage: null, rotation: 0 }],
          [id],
        ),
        nextPageId: state.nextPageId + 1,
      };
    }
    case "show-selection":
      return { ...state, showSelection: action.open };
    case "thumbnail-scale":
      return {
        ...state,
        thumbnailScale: Math.min(
          MAX_PAGE_THUMBNAIL_SCALE,
          Math.max(MIN_PAGE_THUMBNAIL_SCALE, action.scale),
        ),
      };
    case "scene": {
      const scene = demoReducer(
        {
          ...initialDemoState,
          navigationToken: state.navigationToken,
          translationToken: state.translationToken,
        },
        { type: "mode", mode: action.mode },
      );
      return {
        ...scene,
        highlighted: false,
        panel: null,
        translationOpen: false,
        thumbnailScale: action.mode === "pages" ? 1.6 : 1,
        fields:
          action.mode === "forms"
            ? { name: "", email: "", note: "", reviewed: false }
            : scene.fields,
      };
    }
    case "mode":
      return {
        ...state,
        page: sourcePageNumber(state, action.mode === "forms" ? 2 : 1),
        navigationToken: state.navigationToken + 1,
        selectedAnnotation: false,
        showSelection: false,
        sidebar: true,
        fit: "width",
        editorMode:
          action.mode === "pages"
            ? "pages"
            : action.mode === "forms"
              ? "form"
              : "annotation",
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
        page: Math.min(state.pages.length, Math.max(1, action.page)),
        navigationToken: state.navigationToken + 1,
        selectedField: null,
      };
    case "visible-page": {
      const page = Math.min(state.pages.length, Math.max(1, action.page));
      return page === state.page ? state : { ...state, page };
    }
    case "close-panels":
      return { ...state, sidebar: false, panel: null };
    case "select-annotation":
      return {
        ...state,
        page: sourcePageNumber(state, 1),
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
        page: action.open ? sourcePageNumber(state, 1) : state.page,
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
        page: sourcePageNumber(state, 2),
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
            navigationToken: state.navigationToken + 1,
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
            navigationToken: state.navigationToken + 1,
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
