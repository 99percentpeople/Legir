import { MAX_EDITOR_SCALE, MIN_EDITOR_SCALE } from "@/constants";
import type { EditorTabSnapshot } from "@/app/editorTabs/types";
import { getEditorTabSourceKey } from "@/app/editorTabs/storeSnapshot";

const STORAGE_KEY = "legir.document-views";
interface DocumentViewState {
  currentPageIndex: number;
  scale: number;
  scrollLeft: number;
  scrollTop: number;
}
const readViews = (): Record<string, DocumentViewState> => {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "{}",
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, DocumentViewState>)
      : {};
  } catch {
    return {};
  }
};

export const saveDocumentViewState = (
  snapshot: Pick<
    EditorTabSnapshot,
    | "saveTarget"
    | "pdfFile"
    | "currentPageIndex"
    | "scale"
    | "pendingViewStateRestore"
  >,
) => {
  const sourceKey = getEditorTabSourceKey(snapshot);
  if (!sourceKey) return;
  const views = readViews();
  views[sourceKey] = {
    currentPageIndex: snapshot.currentPageIndex,
    scale: snapshot.scale,
    scrollLeft: snapshot.pendingViewStateRestore?.scrollLeft ?? 0,
    scrollTop: snapshot.pendingViewStateRestore?.scrollTop ?? 0,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
};

export const getDocumentViewState = (options: {
  sourceKey: string | null;
  pageCount: number;
}) => {
  const saved = options.sourceKey ? readViews()[options.sourceKey] : null;
  if (
    !saved ||
    !Number.isFinite(saved.scale) ||
    !Number.isFinite(saved.currentPageIndex) ||
    !Number.isFinite(saved.scrollLeft) ||
    !Number.isFinite(saved.scrollTop)
  ) {
    return { currentPageIndex: 0, pendingViewStateRestore: null };
  }
  return {
    currentPageIndex: Math.max(
      0,
      Math.min(
        Math.max(0, options.pageCount - 1),
        Math.floor(saved.currentPageIndex),
      ),
    ),
    pendingViewStateRestore: {
      scale: Math.max(
        MIN_EDITOR_SCALE,
        Math.min(MAX_EDITOR_SCALE, saved.scale),
      ),
      scrollLeft: Math.max(0, saved.scrollLeft),
      scrollTop: Math.max(0, saved.scrollTop),
    },
  };
};
