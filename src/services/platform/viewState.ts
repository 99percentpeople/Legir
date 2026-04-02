import type { PersistedEditorWorkspaceDraft } from "@/app/editorTabs/persistence";
import type { EditorState } from "@/types";
import { recentFilesService } from "@/services/recentFilesService";
import {
  clearWorkspaceDraft,
  getWorkspaceDraft,
  saveWorkspaceDraft,
} from "@/services/storageService";

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
};

export const getSavedViewStateForSaveTarget = (
  saveTarget: EditorState["saveTarget"] | null,
): PersistedEditorViewState | null => {
  if (saveTarget?.kind !== "tauri") return null;
  return recentFilesService.getViewState(saveTarget.path) ?? null;
};

export const hasSavedDraftSession = () => {
  if (isDesktopApp()) return false;
  return recentFilesService.hasWebSession();
};

export const getSavedDraftWorkspace =
  async (): Promise<PersistedEditorWorkspaceDraft | null> => {
    if (isDesktopApp()) return null;
    return await getWorkspaceDraft();
  };

export const clearSavedDraftSession = async () => {
  if (isDesktopApp()) return;
  recentFilesService.setWebSession(false);
  await clearWorkspaceDraft();
};

export const persistPlatformWorkspaceSession = async (
  workspaceDraft: PersistedEditorWorkspaceDraft,
) => {
  if (getPlatformDocumentSaveMode() !== "draft") return false;

  await saveWorkspaceDraft(workspaceDraft);
  recentFilesService.setWebSession(workspaceDraft.tabs.length > 0);
  return true;
};
