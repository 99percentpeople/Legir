import type { EditorState, HistorySnapshot } from "@/types";
import type { EditorActions, EditorStoreSlice } from "@/store/store.types";
import {
  getPageId,
  mapPageIndexes,
} from "@/services/pdfService/lib/pageStructure";
import { revokeObjectUrlIfNeeded } from "../helpers";

export const captureHistorySnapshot = (
  state: EditorState,
): HistorySnapshot => ({
  fields: state.fields,
  annotations: state.annotations,
  metadata: state.metadata,
  exportPassword: state.exportPassword,
  dirtyPermissionScopes: state.dirtyPermissionScopes,
  pages: state.pages,
  pageSources: state.pageSources,
  preservedSourceAnnotations: state.preservedSourceAnnotations,
  outline: state.outline,
  selectedPageIds: state.selectedPageIds,
  currentPageIndex: state.currentPageIndex,
});

export const createHistorySlice: EditorStoreSlice<
  Pick<EditorActions, "saveCheckpoint" | "undo" | "redo">
> = (set, get) => {
  const restore = (snapshot: HistorySnapshot) => {
    const state = get();
    const pages = snapshot.pages ?? state.pages;
    const indexes = mapPageIndexes(state.pages, pages);
    const images: Record<number, string> = {};
    for (const [before, after] of indexes)
      if (after !== undefined && state.thumbnailImages[before])
        images[after] = state.thumbnailImages[before];
    const previews: Record<number, string> = {};
    for (const [before, after] of indexes)
      if (after !== undefined && state.pagePreviewImages[before])
        previews[after] = state.pagePreviewImages[before];
    const retainedPreviews = new Set(Object.values(previews));
    for (const url of new Set(Object.values(state.pagePreviewImages)))
      if (!retainedPreviews.has(url)) revokeObjectUrlIfNeeded(url);
    if (state.pages !== pages) {
      state.cancelThumbnailWarmup();
      const kept = new Set(Object.values(images));
      for (const url of new Set(Object.values(state.thumbnailImages)))
        if (!kept.has(url)) revokeObjectUrlIfNeeded(url);
    }
    const currentPageIndex = Math.min(
      snapshot.currentPageIndex ?? state.currentPageIndex,
      Math.max(0, pages.length - 1),
    );
    return {
      ...snapshot,
      pages,
      pageSources: snapshot.pageSources ?? state.pageSources,
      outline: snapshot.outline ?? state.outline,
      preservedSourceAnnotations:
        snapshot.preservedSourceAnnotations ?? state.preservedSourceAnnotations,
      selectedPageIds:
        snapshot.selectedPageIds?.filter((id) =>
          pages.some((page) => getPageId(page) === id),
        ) ?? [],
      currentPageIndex,
      selectedId: null,
      isDirty: true,
      ...(state.pages !== pages
        ? {
            thumbnailImages: images,
            pagePreviewImages: previews,
            pageTranslateParagraphCandidates: [],
            pageTranslateSelectedParagraphIds: [],
          }
        : {}),
    };
  };
  return {
    saveCheckpoint: () =>
      set((state) => ({
        past: [...state.past, captureHistorySnapshot(state)].slice(-50),
        future: [],
      })),
    undo: () => {
      const state = get();
      const previous = state.past.at(-1);
      if (!previous) return;
      set({
        ...restore(previous),
        past: state.past.slice(0, -1),
        future: [captureHistorySnapshot(state), ...state.future],
      });
    },
    redo: () => {
      const state = get();
      const next = state.future[0];
      if (!next) return;
      set({
        ...restore(next),
        past: [...state.past, captureHistorySnapshot(state)].slice(-50),
        future: state.future.slice(1),
      });
    },
  };
};
