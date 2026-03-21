import type { EditorState } from "@/types";
import { recentFilesService } from "@/services/recentFilesService";
import { saveDraft } from "@/services/storageService";

import { isDesktopApp } from "./runtime";

type ScrollContainer = Pick<HTMLElement, "scrollLeft" | "scrollTop"> | null;

export type PersistedEditorViewState = {
  scale: number;
  scrollLeft: number;
  scrollTop: number;
  updatedAt: number;
  pageIndex?: number;
};

export const getPlatformDocumentSaveMode = (): "file" | "draft" => {
  return isDesktopApp() ? "file" : "draft";
};

const readScrollPosition = (scrollContainer: ScrollContainer) => {
  if (!scrollContainer) return null;
  return {
    scrollLeft: scrollContainer.scrollLeft,
    scrollTop: scrollContainer.scrollTop,
  };
};

export const saveEditorViewState = (options: {
  saveTarget: EditorState["saveTarget"] | null;
  pagesLength: number;
  scale: number;
  currentPageIndex: number;
  scrollContainer: ScrollContainer;
}) => {
  const scroll = readScrollPosition(options.scrollContainer);
  if (!scroll) return;

  if (options.saveTarget?.kind === "tauri") {
    recentFilesService.saveTauriViewState({
      path: options.saveTarget.path,
      scale: options.scale,
      pageIndex: options.currentPageIndex,
      scrollLeft: scroll.scrollLeft,
      scrollTop: scroll.scrollTop,
    });
    return;
  }

  if (!isDesktopApp() && options.pagesLength > 0) {
    recentFilesService.saveWebDraftViewState({
      scale: options.scale,
      scrollLeft: scroll.scrollLeft,
      scrollTop: scroll.scrollTop,
    });
  }
};

export const saveDraftViewStateIfSupported = (options: {
  pagesLength: number;
  scale: number;
  scrollContainer: ScrollContainer;
}) => {
  if (isDesktopApp()) return;

  const scroll = readScrollPosition(options.scrollContainer);
  if (!scroll || options.pagesLength <= 0) return;

  recentFilesService.saveWebDraftViewState({
    scale: options.scale,
    scrollLeft: scroll.scrollLeft,
    scrollTop: scroll.scrollTop,
  });
};

export const getSavedViewStateForSaveTarget = (
  saveTarget: EditorState["saveTarget"] | null,
): PersistedEditorViewState | null => {
  if (saveTarget?.kind !== "tauri") return null;
  return recentFilesService.getViewState(saveTarget.path) ?? null;
};

export const getSavedDraftViewState = (): PersistedEditorViewState | null => {
  if (isDesktopApp()) return null;
  return recentFilesService.getWebDraftView();
};

export const hasSavedDraftSession = () => {
  if (isDesktopApp()) return false;
  return recentFilesService.hasWebSession();
};

export const setSavedDraftSession = (hasSaved: boolean) => {
  if (isDesktopApp()) return;
  recentFilesService.setWebSession(hasSaved);
};

export const persistPlatformDraftSession = async (options: {
  pdfBytes: Uint8Array;
  fields: EditorState["fields"];
  annotations: EditorState["annotations"];
  metadata: EditorState["metadata"];
  filename: string;
}) => {
  if (getPlatformDocumentSaveMode() !== "draft") return false;

  await saveDraft({
    pdfBytes: options.pdfBytes,
    fields: options.fields,
    annotations: options.annotations,
    metadata: options.metadata,
    filename: options.filename,
  });
  recentFilesService.setWebSession(true);
  return true;
};
