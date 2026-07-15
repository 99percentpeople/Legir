import { EMPTY_PDF_PERMISSION_DIRTY_SCOPES } from "@/lib/pdfPermissions";
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

export interface EditorTabSessionTransfer {
  transferId: string;
  createdAt: number;
  sessionId: string;
  sourceWindowId: EditorWindowId;
  title: string;
  sourceKey: string | null;
  lastActiveAt: string;
  isDirty: boolean;
  editorSnapshot: EditorTabSnapshot;
}

interface RestoredEditorTabTransfer {
  id: string;
  title: string;
  sourceKey: string | null;
  lastActiveAt: string;
  isDirty: boolean;
  snapshot: EditorTabSnapshot;
  workerService: PDFWorkerService;
  disposePdfResources: (() => void) | null;
}

const createTransferId = () =>
  `tab_transfer_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const cloneSaveTargetForTransfer = (
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
      ...(saveTarget.id ? { id: saveTarget.id } : {}),
    };
  }

  return null;
};

const cloneEditorTabSnapshotForTransfer = (
  snapshot: EditorTabSnapshot,
): EditorTabSnapshot => ({
  ...snapshot,
  pdfFile: null,
  pdfBytes: snapshot.pdfBytes ? new Uint8Array(snapshot.pdfBytes) : null,
  metadata: {
    ...snapshot.metadata,
    documentPermissions: snapshot.documentPermissions
      ? { ...snapshot.documentPermissions }
      : (snapshot.metadata.documentPermissions ?? null),
  },
  documentPermissions: snapshot.documentPermissions
    ? { ...snapshot.documentPermissions }
    : null,
  sourceDocumentPermissions: snapshot.sourceDocumentPermissions
    ? { ...snapshot.sourceDocumentPermissions }
    : null,
  pdfOwnerUnlocked: snapshot.pdfOwnerUnlocked,
  pdfOwnerPassword: snapshot.pdfOwnerPassword,
  preservePdfOwnerRestrictionsOnSave:
    snapshot.preservePdfOwnerRestrictionsOnSave,
  dirtyPermissionScopes: {
    ...(snapshot.dirtyPermissionScopes ?? EMPTY_PDF_PERMISSION_DIRTY_SCOPES),
  },
  saveTarget: cloneSaveTargetForTransfer(snapshot.saveTarget),
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

const mergeTransferredAnnotations = (
  annotations: EditorTabSnapshot["annotations"],
  loadedAnnotations: EditorTabSnapshot["annotations"],
) => {
  const nonLinkAnnotations = annotations.filter(
    (annotation) => annotation.type !== "link",
  );
  const liveLinkAnnotations = loadedAnnotations.filter(
    (annotation) => annotation.type === "link",
  );
  return [...nonLinkAnnotations, ...liveLinkAnnotations];
};

export const createEditorTabSessionTransfer = (
  session: EditorTabSession,
): EditorTabSessionTransfer => ({
  transferId: createTransferId(),
  createdAt: Date.now(),
  sessionId: session.id,
  sourceWindowId: session.windowId,
  title: session.title,
  sourceKey: session.sourceKey,
  lastActiveAt: session.lastActiveAt,
  isDirty: session.isDirty,
  editorSnapshot: cloneEditorTabSnapshotForTransfer(session.editorSnapshot),
});

export const restoreEditorTabSessionTransfer = async (
  transfer: EditorTabSessionTransfer,
): Promise<RestoredEditorTabTransfer> => {
  const incomingSnapshot = cloneEditorTabSnapshotForTransfer(
    transfer.editorSnapshot,
  );

  if (!incomingSnapshot.pdfBytes) {
    throw new Error("Transferred tab is missing PDF bytes.");
  }

  const workerService = createPdfWorkerService();
  try {
    const { loadPDF } = await import("@/services/pdfService");
    const {
      pdfBytes,
      pages,
      annotations,
      preservedSourceAnnotations,
      outline,
      documentPermissions,
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
      documentPermissions,
      sourceDocumentPermissions:
        incomingSnapshot.sourceDocumentPermissions ?? documentPermissions,
      filename: incomingSnapshot.filename,
      saveTarget: incomingSnapshot.saveTarget,
      pages,
      fields: incomingSnapshot.fields,
      annotations: mergeTransferredAnnotations(
        incomingSnapshot.annotations,
        annotations,
      ),
      preservedSourceAnnotations,
      outline,
      currentPageIndex: incomingSnapshot.currentPageIndex,
      pendingViewStateRestore: incomingSnapshot.pendingViewStateRestore,
    });

    const effectiveDocumentPermissions = incomingSnapshot.pdfOwnerUnlocked
      ? incomingSnapshot.documentPermissions
      : documentPermissions;
    const sourceDocumentPermissions =
      incomingSnapshot.sourceDocumentPermissions ?? documentPermissions;

    return {
      id: transfer.sessionId,
      title:
        transfer.title || getEditorTabDisplayTitle(incomingSnapshot.filename),
      sourceKey: transfer.sourceKey,
      lastActiveAt: transfer.lastActiveAt,
      isDirty: transfer.isDirty,
      snapshot: {
        ...baseSnapshot,
        ...incomingSnapshot,
        pdfFile: null,
        pdfBytes,
        pdfOpenPassword: openPassword ?? incomingSnapshot.pdfOpenPassword,
        metadata: {
          ...incomingSnapshot.metadata,
          documentPermissions: effectiveDocumentPermissions,
        },
        documentPermissions: effectiveDocumentPermissions
          ? { ...effectiveDocumentPermissions }
          : null,
        sourceDocumentPermissions: sourceDocumentPermissions
          ? { ...sourceDocumentPermissions }
          : null,
        pdfOwnerUnlocked: incomingSnapshot.pdfOwnerUnlocked,
        pdfOwnerPassword: incomingSnapshot.pdfOwnerPassword,
        preservePdfOwnerRestrictionsOnSave:
          incomingSnapshot.preservePdfOwnerRestrictionsOnSave,
        saveTarget: cloneSaveTargetForTransfer(incomingSnapshot.saveTarget),
        pages: [...pages],
        fields: [...incomingSnapshot.fields],
        annotations: mergeTransferredAnnotations(
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
        isDirty: transfer.isDirty,
      },
      workerService,
      disposePdfResources: dispose,
    };
  } catch (error) {
    workerService.destroy();
    throw error;
  }
};
