import { loadPDF } from "@/services/pdfService";
import {
  createPdfWorkerService,
  type PDFWorkerService,
} from "@/services/pdfService/pdfWorkerService";
import type { EditorSaveTarget } from "@/types";
import {
  createLoadedEditorTabSnapshot,
  getEditorTabDisplayTitle,
} from "./storeSnapshot";
import type {
  EditorTabSession,
  EditorTabSnapshot,
  EditorWindowId,
} from "./types";

export interface PersistedEditorTabSessionDraft {
  id: string;
  windowId: EditorWindowId;
  title: string;
  sourceKey: string | null;
  lastActiveAt: string;
  isDirty: boolean;
  editorSnapshot: EditorTabSnapshot;
}

export interface PersistedEditorWorkspaceDraft {
  tabs: PersistedEditorTabSessionDraft[];
  activeTabId: string | null;
  updatedAt: number;
}

export interface RestoredPersistedEditorTabSession {
  id: string;
  title: string;
  sourceKey: string | null;
  lastActiveAt: string;
  isDirty: boolean;
  snapshot: EditorTabSnapshot;
  workerService: PDFWorkerService;
  disposePdfResources: (() => void) | null;
}

const cloneSaveTargetForPersistence = (
  saveTarget: EditorSaveTarget | null,
): EditorSaveTarget | null => {
  if (saveTarget?.kind === "tauri") {
    return {
      kind: "tauri",
      path: saveTarget.path,
    };
  }

  if (saveTarget?.kind === "web") {
    return {
      kind: "web",
      handle: saveTarget.handle,
    };
  }

  return null;
};

const cloneEditorTabSnapshotForPersistence = (
  snapshot: EditorTabSnapshot,
): EditorTabSnapshot => ({
  ...snapshot,
  pdfFile: null,
  pdfBytes: snapshot.pdfBytes ? new Uint8Array(snapshot.pdfBytes) : null,
  metadata: { ...snapshot.metadata },
  saveTarget: cloneSaveTargetForPersistence(snapshot.saveTarget),
  pages: [...snapshot.pages],
  fields: [...snapshot.fields],
  annotations: [...snapshot.annotations],
  preservedSourceAnnotations: [...snapshot.preservedSourceAnnotations],
  outline: [...snapshot.outline],
  penStyle: { ...snapshot.penStyle },
  highlightStyle: snapshot.highlightStyle
    ? { ...snapshot.highlightStyle }
    : undefined,
  commentStyle: snapshot.commentStyle
    ? { ...snapshot.commentStyle }
    : undefined,
  freetextStyle: snapshot.freetextStyle
    ? { ...snapshot.freetextStyle }
    : undefined,
  shapeStyle: snapshot.shapeStyle ? { ...snapshot.shapeStyle } : undefined,
  past: [...snapshot.past],
  future: [...snapshot.future],
  clipboard: snapshot.clipboard
    ? {
        type: snapshot.clipboard.type,
        data: snapshot.clipboard.data,
      }
    : null,
  pageTranslateOptions: { ...snapshot.pageTranslateOptions },
  pageTranslateParagraphCandidates: [
    ...snapshot.pageTranslateParagraphCandidates,
  ],
  pageTranslateSelectedParagraphIds: [
    ...snapshot.pageTranslateSelectedParagraphIds,
  ],
  lastSavedAt: snapshot.lastSavedAt ? new Date(snapshot.lastSavedAt) : null,
  rightPanelDockTab: [...snapshot.rightPanelDockTab],
  pendingViewStateRestore: snapshot.pendingViewStateRestore
    ? { ...snapshot.pendingViewStateRestore }
    : null,
});

const mergePersistedAnnotations = (
  persistedAnnotations: EditorTabSnapshot["annotations"],
  loadedAnnotations: EditorTabSnapshot["annotations"],
) => {
  const nonLinkAnnotations = persistedAnnotations.filter(
    (annotation) => annotation.type !== "link",
  );
  const liveLinkAnnotations = loadedAnnotations.filter(
    (annotation) => annotation.type === "link",
  );
  return [...nonLinkAnnotations, ...liveLinkAnnotations];
};

export const createPersistedEditorWorkspaceDraft = (options: {
  tabs: EditorTabSession[];
  activeTabId: string | null;
}): PersistedEditorWorkspaceDraft => ({
  tabs: options.tabs.map((tab) => ({
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title,
    sourceKey: tab.sourceKey,
    lastActiveAt: tab.lastActiveAt,
    isDirty: tab.isDirty,
    editorSnapshot: cloneEditorTabSnapshotForPersistence(tab.editorSnapshot),
  })),
  activeTabId: options.activeTabId,
  updatedAt: Date.now(),
});

export const restorePersistedEditorTabSession = async (
  persistedTab: PersistedEditorTabSessionDraft,
): Promise<RestoredPersistedEditorTabSession> => {
  const incomingSnapshot = cloneEditorTabSnapshotForPersistence(
    persistedTab.editorSnapshot,
  );

  if (!incomingSnapshot.pdfBytes) {
    throw new Error("Persisted tab is missing PDF bytes.");
  }

  const workerService = createPdfWorkerService();

  try {
    const {
      pdfBytes,
      pages,
      annotations,
      preservedSourceAnnotations,
      outline,
      openPassword,
      dispose,
    } = await loadPDF(incomingSnapshot.pdfBytes, {
      password: incomingSnapshot.pdfOpenPassword,
      workerService,
    });

    const baseSnapshot = createLoadedEditorTabSnapshot({
      pdfFile: null,
      pdfBytes,
      pdfOpenPassword: openPassword ?? incomingSnapshot.pdfOpenPassword,
      metadata: incomingSnapshot.metadata,
      filename: incomingSnapshot.filename,
      saveTarget: incomingSnapshot.saveTarget,
      pages,
      fields: incomingSnapshot.fields,
      annotations: mergePersistedAnnotations(
        incomingSnapshot.annotations,
        annotations,
      ),
      preservedSourceAnnotations,
      outline,
      currentPageIndex: incomingSnapshot.currentPageIndex,
      pendingViewStateRestore: incomingSnapshot.pendingViewStateRestore,
    });

    return {
      id: persistedTab.id,
      title:
        persistedTab.title ||
        getEditorTabDisplayTitle(incomingSnapshot.filename),
      sourceKey: persistedTab.sourceKey,
      lastActiveAt: persistedTab.lastActiveAt,
      isDirty: persistedTab.isDirty,
      snapshot: {
        ...baseSnapshot,
        ...incomingSnapshot,
        pdfFile: null,
        pdfBytes,
        pdfOpenPassword: openPassword ?? incomingSnapshot.pdfOpenPassword,
        metadata: { ...incomingSnapshot.metadata },
        saveTarget: cloneSaveTargetForPersistence(incomingSnapshot.saveTarget),
        pages: [...pages],
        fields: [...incomingSnapshot.fields],
        annotations: mergePersistedAnnotations(
          incomingSnapshot.annotations,
          annotations,
        ),
        preservedSourceAnnotations: [...preservedSourceAnnotations],
        outline: [...outline],
        past: [...incomingSnapshot.past],
        future: [...incomingSnapshot.future],
        clipboard: incomingSnapshot.clipboard
          ? {
              type: incomingSnapshot.clipboard.type,
              data: incomingSnapshot.clipboard.data,
            }
          : null,
        pageTranslateOptions: { ...incomingSnapshot.pageTranslateOptions },
        pageTranslateParagraphCandidates: [
          ...incomingSnapshot.pageTranslateParagraphCandidates,
        ],
        pageTranslateSelectedParagraphIds: [
          ...incomingSnapshot.pageTranslateSelectedParagraphIds,
        ],
        lastSavedAt: incomingSnapshot.lastSavedAt
          ? new Date(incomingSnapshot.lastSavedAt)
          : null,
        rightPanelDockTab: [...incomingSnapshot.rightPanelDockTab],
        pendingViewStateRestore: incomingSnapshot.pendingViewStateRestore
          ? { ...incomingSnapshot.pendingViewStateRestore }
          : null,
        isDirty: persistedTab.isDirty,
      },
      workerService,
      disposePdfResources: dispose,
    };
  } catch (error) {
    workerService.destroy();
    throw error;
  }
};
