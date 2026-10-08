import { normalizeControlLayerOrders } from "@/lib/controlLayerOrder";
import { prepareAnnotationsForStore } from "@/lib/inkGeometry";
import { initialState } from "@/store/helpers";
import type {
  Annotation,
  EditorSaveTarget,
  EditorState,
  DocumentState,
  FormField,
  PDFMetadata,
  PreservedSourceAnnotationRef,
} from "@/types";
import type { LoadedPdfDocument } from "@/services/pdfService";
import type { EditorTabSnapshot, EditorTabSession } from "./types";

const WINDOW_ID_FALLBACK = "tab";

const createShallowArrayCopy = <T>(value: T[]) => [...value];

const createPendingViewStateSnapshot = (
  state: DocumentState,
  scrollContainer: HTMLElement | null,
) => {
  if (state.pages.length === 0) return null;
  if (!scrollContainer) {
    return state.pendingViewStateRestore
      ? { ...state.pendingViewStateRestore }
      : null;
  }
  return {
    scale: state.scale,
    scrollLeft: scrollContainer.scrollLeft,
    scrollTop: scrollContainer.scrollTop,
  };
};

export const getEditorTabDisplayTitle = (filename: string | null | undefined) =>
  filename?.trim() || "Untitled";

export const getEditorTabSourceKey = (options: {
  saveTarget: EditorSaveTarget | null;
  pdfFile?: File | null;
}) => {
  if (options.saveTarget?.kind === "tauri") {
    return `tauri:${options.saveTarget.path}`;
  }

  if (options.saveTarget?.kind === "web") {
    const saveTargetId = options.saveTarget.id?.trim();
    if (saveTargetId) {
      return `web-file:${saveTargetId}`;
    }

    const handleName = options.saveTarget.handle?.name?.trim();
    return handleName ? `web-handle:${handleName}` : null;
  }

  const file = options.pdfFile;
  if (file) {
    return `web-file:${file.name}:${file.size}:${file.lastModified}`;
  }

  return null;
};

export const createEditorTabId = () =>
  `${WINDOW_ID_FALLBACK}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const createEditorTabSnapshotFromState = (options: {
  state: DocumentState;
  scrollContainer: HTMLElement | null;
}): EditorTabSnapshot => {
  const { state } = options;

  return {
    pdfFile: state.pdfFile,
    pdfBytes: state.pdfBytes,
    pdfOpenPassword: state.pdfOpenPassword,
    exportPassword: state.exportPassword,
    metadata: { ...state.metadata },
    documentPermissions: state.documentPermissions
      ? { ...state.documentPermissions }
      : null,
    sourceDocumentPermissions: state.sourceDocumentPermissions
      ? { ...state.sourceDocumentPermissions }
      : null,
    pdfOwnerUnlocked: state.pdfOwnerUnlocked,
    pdfOwnerPassword: state.pdfOwnerPassword,
    preservePdfOwnerRestrictionsOnSave:
      state.preservePdfOwnerRestrictionsOnSave,
    dirtyPermissionScopes: { ...state.dirtyPermissionScopes },
    filename: state.filename,
    saveTarget: state.saveTarget,
    pages: createShallowArrayCopy(state.pages),
    fields: createShallowArrayCopy(state.fields),
    annotations: createShallowArrayCopy(state.annotations),
    preservedSourceAnnotations: createShallowArrayCopy(
      state.preservedSourceAnnotations,
    ),
    outline: createShallowArrayCopy(state.outline),
    documentLoadState: state.documentLoadState,
    documentLoadError: state.documentLoadError,
    mode: state.mode,
    tool: state.tool,

    selectedId: state.selectedId,
    scale: state.scale,
    viewRotation: state.viewRotation,
    past: createShallowArrayCopy(state.past),
    future: createShallowArrayCopy(state.future),
    clipboard: state.clipboard
      ? {
          type: state.clipboard.type,
          data: state.clipboard.data,
        }
      : null,

    pageTranslateParagraphCandidates: createShallowArrayCopy(
      state.pageTranslateParagraphCandidates,
    ),
    pageTranslateSelectedParagraphIds: createShallowArrayCopy(
      state.pageTranslateSelectedParagraphIds,
    ),
    lastSavedAt: state.lastSavedAt ? new Date(state.lastSavedAt) : null,

    isDirty: state.isDirty,
    currentPageIndex: state.currentPageIndex,
    pendingViewStateRestore: createPendingViewStateSnapshot(
      state,
      options.scrollContainer,
    ),

    fitTrigger: state.fitTrigger,
  };
};

export const createLoadedEditorTabSnapshot = (options: {
  pdfFile: File | null;
  pdfBytes: Uint8Array;
  pdfOpenPassword: string | null;
  metadata: PDFMetadata;
  documentPermissions: EditorState["documentPermissions"];
  sourceDocumentPermissions?: EditorState["sourceDocumentPermissions"];
  filename: string;
  saveTarget: EditorState["saveTarget"] | null;
  pages: EditorState["pages"];
  fields: FormField[];
  annotations: Annotation[];
  preservedSourceAnnotations: PreservedSourceAnnotationRef[];
  outline: EditorState["outline"];
  documentLoadState?: EditorState["documentLoadState"];
  documentLoadError?: EditorState["documentLoadError"];
  currentPageIndex?: number;
  pendingViewStateRestore?: EditorState["pendingViewStateRestore"];
}): EditorTabSnapshot => {
  const normalized = normalizeControlLayerOrders(
    options.fields,
    prepareAnnotationsForStore(options.annotations),
  );

  return {
    ...createEditorTabSnapshotFromState({
      state: initialState,
      scrollContainer: null,
    }),
    pdfFile: options.pdfFile,
    pdfBytes: options.pdfBytes,
    pdfOpenPassword: options.pdfOpenPassword,
    exportPassword: options.pdfOpenPassword,
    metadata: {
      ...options.metadata,
      documentPermissions: options.documentPermissions
        ? { ...options.documentPermissions }
        : null,
    },
    documentPermissions: options.documentPermissions
      ? { ...options.documentPermissions }
      : null,
    sourceDocumentPermissions: options.sourceDocumentPermissions
      ? { ...options.sourceDocumentPermissions }
      : options.documentPermissions
        ? { ...options.documentPermissions }
        : null,
    pdfOwnerUnlocked: initialState.pdfOwnerUnlocked,
    pdfOwnerPassword: initialState.pdfOwnerPassword,
    preservePdfOwnerRestrictionsOnSave:
      options.documentPermissions?.hasOwnerRestrictions ?? false,
    dirtyPermissionScopes: { ...initialState.dirtyPermissionScopes },
    filename: options.filename,
    saveTarget: options.saveTarget,
    pages: createShallowArrayCopy(options.pages),
    fields: normalized.fields,
    annotations: normalized.annotations,
    preservedSourceAnnotations: createShallowArrayCopy(
      options.preservedSourceAnnotations,
    ),
    outline: createShallowArrayCopy(options.outline),
    documentLoadState: options.documentLoadState ?? "ready",
    documentLoadError: options.documentLoadError ?? null,
    currentPageIndex: options.currentPageIndex ?? 0,
    pendingViewStateRestore: options.pendingViewStateRestore
      ? { ...options.pendingViewStateRestore }
      : null,
  };
};

export const hydratedPdfDocumentPatch = (
  document: LoadedPdfDocument,
): Partial<DocumentState> => {
  const normalized = normalizeControlLayerOrders(
    document.fields,
    prepareAnnotationsForStore(document.annotations),
  );

  return {
    metadata: {
      ...document.metadata,
      documentPermissions: { ...document.documentPermissions },
    },
    documentPermissions: { ...document.documentPermissions },
    sourceDocumentPermissions: { ...document.documentPermissions },
    preservePdfOwnerRestrictionsOnSave:
      document.documentPermissions.hasOwnerRestrictions,
    fields: normalized.fields,
    annotations: normalized.annotations,
    preservedSourceAnnotations: createShallowArrayCopy(
      document.preservedSourceAnnotations,
    ),
    outline: createShallowArrayCopy(document.outline),
    documentLoadState: "ready",
    documentLoadError: null,
  };
};

export const getEditorTabTitle = (session: EditorTabSession) =>
  getEditorTabDisplayTitle(session.runtime.store.document.getState().filename);
export const getEditorTabSnapshot = (session: EditorTabSession) =>
  createEditorTabSnapshotFromState({
    state: session.runtime.store.document.getState(),
    scrollContainer: session.runtime.scrollContainer,
  });
