import type {
  Annotation,
  EditorState,
  EditorUiState,
  FormField,
  PDFSearchResult,
  PenStyle,
} from "@/types";

export interface EditorPageProps {
  onExport: () => Promise<boolean>;
  onSaveDraft: (silent?: boolean) => Promise<void>;
  onSaveAs: () => Promise<boolean>;
  onExit: () => void;
  onPrint: () => void;
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
  onExport: () => Promise<boolean>;
  onSaveDraft: (silent?: boolean) => Promise<void>;
  onSaveAs: () => Promise<boolean>;
  onPrint: () => void;
  onExit: () => void;
  onClose: () => void;
}

export type SelectedEditorControl = FormField | Annotation | null;

export type WorkspaceTextHighlightsByPage =
  | Map<number, PDFSearchResult[]>
  | undefined;
