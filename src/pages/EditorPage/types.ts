import type {
  Annotation,
  EditorState,
  EditorUiState,
  FormField,
  PDFSearchResult,
  PenStyle,
} from "@/types";
import type {
  EditorTabDescriptor,
  EditorWindowId,
} from "@/app/editorTabs/types";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";

export interface EditorMergeWindowTarget {
  windowId: EditorWindowId;
  label: string;
}

export type EditorTabDropIntent =
  | "reorder"
  | "merge-to-window"
  | "detach-to-new-window";

export interface EditorTabDragPayload {
  tabId: string;
  sourceWindowId: EditorWindowId;
}

export interface EditorTabDropTarget {
  intent: EditorTabDropIntent;
  windowId: EditorWindowId;
  targetIndex?: number;
}

export interface EditorPageProps {
  windowId: EditorWindowId;
  tabs: EditorTabDescriptor[];
  activeTabId: string | null;
  workerService: PDFWorkerService | null;
  isFileDragActive: boolean;
  mergeWindowTargets: EditorMergeWindowTarget[];
  onOpenDocument: () => Promise<void>;
  onRefreshMergeWindowTargets: () => Promise<void>;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onMoveTab: (tabId: string, target: EditorTabDropTarget) => void;
  onDetachTab: (tabId: string) => Promise<void>;
  onMergeTabToWindow: (
    tabId: string,
    targetWindowId: EditorWindowId,
  ) => Promise<void>;
  canDetachTabs: boolean;
  canMergeTabs: boolean;
  onSave: () => Promise<boolean>;
  onSaveAs: () => Promise<boolean>;
  onExit: () => void;
  onPrint: () => void;
  onRequestCloseCurrentTab: () => void;
}

export type TranslateFn = (
  key: string,
  params?: Record<string, string | number>,
) => string;

export type EditorStateSetter = (
  next:
    | Partial<EditorState>
    | ((prev: EditorState) => Partial<EditorState> | EditorState),
) => void;

export type EditorUiStateSetter = (
  next:
    | Partial<EditorUiState>
    | ((prev: EditorState) => Partial<EditorUiState>),
) => void;

export type EditorPageCloseSource = "menu" | "window";

export interface EditorCanvasMobileToolbar {
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onModeChange: (mode: EditorState["mode"]) => void;
  onPenStyleChange: (style: Partial<PenStyle>) => void;
  onHighlightStyleChange: (style: Partial<PenStyle>) => void;
  onCommentStyleChange: (style: { color: string }) => void;
  onFreetextStyleChange: (style: { color: string }) => void;
  onShapeStyleChange: (
    style: Partial<NonNullable<EditorState["shapeStyle"]>>,
  ) => void;
  onStampStyleChange: (
    style: Partial<NonNullable<EditorState["stampStyle"]>>,
  ) => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenShortcuts: () => void;
  onOpenSearch: () => void;
  isFieldListOpen: boolean;
  onToggleFieldList: () => void;
  isPropertiesPanelOpen: boolean;
  onTogglePropertiesPanel: () => void;
  onOpenSettings: () => void;
  isSearchOpen: boolean;
  onSave: () => Promise<boolean>;
  onSaveAs: () => Promise<boolean>;
  onPrint: () => void;
  onExit: () => void;
  onClose: () => void;
}

export type SelectedEditorControl = FormField | Annotation | null;

export type WorkspaceTextHighlightsByPage =
  | Map<number, PDFSearchResult[]>
  | undefined;
