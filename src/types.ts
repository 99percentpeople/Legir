export { FieldType } from "@legir/pdf-model";
export type {
  EditorMode,
  PageLayoutMode,
  PageFlowDirection,
  ThumbnailsLayoutMode,
  Tool,
  MoveDirection,
  ControlLayerMove,
  FieldStyle,
  FormField,
  Annotation,
  AnnotationReply,
  PDFMetadata,
  PDFDocumentPermissions,
  PDFPermissionDirtyScopes,
  PDFOutlineItem,
  PageData,
  PageSource,
  HistorySnapshot,
  PreservedSourceAnnotationRef,
  StampImageFrame,
  StampAppearanceSource,
  StampIntrinsicSize,
  StampNormalizedBox,
  StampImageResource,
  StampImageAppearance,
  AnnotationStampData,
  ImageCompressionOptions,
  TranslateOptionId,
  PDFSearchDisplaySegment,
  PDFSearchResult,
} from "@legir/pdf-model";
import {
  EditorMode,
  PageLayoutMode,
  PageFlowDirection,
  ThumbnailsLayoutMode,
  Tool,
  FormField,
  Annotation,
  PDFMetadata,
  PDFDocumentPermissions,
  PDFPermissionDirtyScopes,
  PDFOutlineItem,
  PageData,
  PageSource,
  HistorySnapshot,
  PreservedSourceAnnotationRef,
  StampImageResource,
  StampImageAppearance,
  ImageCompressionOptions,
  TranslateOptionId,
} from "@legir/pdf-model";
/**
 * Application state contracts. Portable PDF document models are re-exported
 * from @legir/pdf-model; UI, platform and AI preferences stay in this file.
 */
import type {
  AiProviderId,
  AiProviderBackendKind,
} from "@/services/ai/providers/catalog";
import type {
  AiReasoningDisplayPolicy,
  AiReasoningLevel,
} from "@/services/ai/providers/runtimeAdapters/types";
import type { StampKind, StampPresetId } from "@legir/pdf-model/stamps";

export type EditorSaveTarget =
  | { kind: "web"; handle: FileSystemFileHandle; id?: string }
  | { kind: "tauri"; path: string };

export interface SnappingOptions {
  enabled: boolean;
  snapToBorders: boolean;
  snapToCenter: boolean;
  snapToEqualDistances: boolean;
  threshold: number;
}

export interface DebugOptions {
  pdfTextLayer: boolean;
  disablePdfTextLayer: boolean;
  pdfZoomRenderTiming: boolean;
  workspaceZoomJank: boolean;
  ignorePdfPermissions: boolean;
}

export type AppLLMModelOption = {
  id: string;
  label: string;
  labelKey?: string;
  capabilities: LLMModelCapabilities;
  rank?: number;
};

export type LLMModelModality =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "file"
  | (string & {});

export interface LLMModelCapabilities {
  inputModalities: LLMModelModality[];
  outputModalities: LLMModelModality[];
  supportsImageInput: boolean;
  supportsToolCalls: boolean;
  contextWindowTokens: number;
}

export interface LLMProviderOptions {
  /** Custom connection name, or a saved catalog label for offline display. */
  name?: string;
  catalogId?: string;
  backendKind?: AiProviderBackendKind;
  /** `api-key` delegates authentication to the selected SDK. */
  authMode?: "api-key" | "bearer" | "none";
  enabled: boolean;
  apiKey?: string;
  apiUrl?: string;
  apiOptionId?: string;
}

/** Keys are stable connection IDs, independent of the catalog. */
export type LLMOptions = Record<AiProviderId, LLMProviderOptions>;

export interface ApiProxyOptions {
  tauriForwardEnabled: boolean;
  proxyUrlEnabled: boolean;
  proxyUrl?: string;
}

export interface TranslationOptions {
  aiEnabled: boolean;
  googleCloud: {
    apiKey: string;
  };
}

export interface AiChatReasoningOptions {
  level: AiReasoningLevel;
  displayPolicy: AiReasoningDisplayPolicy;
}

export interface AiChatOptions {
  visualModelKey?: string;
  formToolsEnabled: boolean;
  contextCompressionEnabled: boolean;
  contextCompressionThresholdPercent: number;
  visualHistoryWindow: number;
  maxToolRounds: number;
  getPagesTextMaxChars: number;
  contextCompressionMode: "algorithmic" | "ai";
  contextCompressionModelKey?: string;
  reasoning: AiChatReasoningOptions;
}

export interface AppOptions {
  snappingOptions: SnappingOptions;
  debugOptions: DebugOptions;
  userName: string;
  thumbnailsLayout: ThumbnailsLayoutMode;
  removeTextUnderFlattenedFreetext: boolean;
  imageCompression: ImageCompressionOptions;

  apiProxy: ApiProxyOptions;
  translation: TranslationOptions;
  llm: LLMOptions;
  aiChat: AiChatOptions;
}

export interface PenStyle {
  color: string;
  thickness: number;
  opacity: number;
}

export type DialogName = "shortcuts" | "settings" | null;

export type PageTranslateContextWindow =
  | "none"
  | "prev"
  | "next"
  | "prev_next"
  | "all_prev"
  | "all_next"
  | "all";

export interface PageTranslateOptions {
  fontFamily: string;
  usePositionAwarePrompt: boolean;
  aiReflowParagraphs: boolean;
  useParagraphs: boolean;
  flattenFreetext: boolean;
  contextWindow: PageTranslateContextWindow;
  paragraphXGap: number;
  paragraphYGap: number;
  paragraphSplitByFontSize: boolean;
  freetextPadding: number;
}

export type PageTranslateParagraphCandidate = {
  id: string;
  pageIndex: number;
  rect: { x: number; y: number; width: number; height: number };
  innerRect?: { x: number; y: number; width: number; height: number };
  sourceText: string;
  fontSize: number;
  fontFamily: string;
  rotationDeg?: number;
  isExcluded: boolean;
};

export type PdfDocumentLoadState = "hydrating" | "ready" | "error";

// Each state has one owner. EditorState is a composed read model for rendering
// and document commands; it is never persisted or stored as a whole.
export interface DocumentState {
  pdfFile: File | null;
  pdfBytes: Uint8Array | null;
  pdfOpenPassword: string | null;
  exportPassword: string | null;
  metadata: PDFMetadata;
  documentPermissions: PDFDocumentPermissions | null;
  sourceDocumentPermissions: PDFDocumentPermissions | null;
  pdfOwnerUnlocked: boolean;
  pdfOwnerPassword: string | null;
  preservePdfOwnerRestrictionsOnSave: boolean;
  dirtyPermissionScopes: PDFPermissionDirtyScopes;
  filename: string;
  saveTarget: EditorSaveTarget | null;
  pages: PageData[];
  pageSources: Record<string, PageSource>;
  selectedPageIds: string[];
  previousEditorMode: "annotation" | "form";
  fields: FormField[];
  annotations: Annotation[];
  preservedSourceAnnotations: PreservedSourceAnnotationRef[];
  outline: PDFOutlineItem[];
  documentLoadState: PdfDocumentLoadState;
  documentLoadError: string | null;
  mode: EditorMode;
  tool: Tool;
  /** Primary control; always belongs to selectedControlIds when selected. */
  selectedId: string | null;
  selectedControlIds: string[];
  scale: number;
  /** Page editor thumbnail zoom, independent of PDF reading zoom. */
  pageThumbnailScale: number;
  /** Temporary reading direction; never changes source pages or PDF export. */
  viewRotation: number;
  isProcessing: boolean;
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  pageTranslateParagraphCandidates: PageTranslateParagraphCandidate[];
  pageTranslateSelectedParagraphIds: string[];
  lastSavedAt: Date | null;
  processingStatus: string | null;
  isSaving: boolean;
  isDirty: boolean;
  currentPageIndex: number;
  pendingViewStateRestore: {
    scale: number;
    scrollLeft: number;
    scrollTop: number;
  } | null;
  fitTrigger: number;
  keys: {
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
    space: boolean;
  };
  actionSignal: {
    type:
      | "UNDO"
      | "REDO"
      | "SAVE"
      | "PRINT"
      | "DELETE"
      | "ESCAPE"
      | "COPY"
      | "PASTE"
      | "CUT"
      | "MOVE_UP"
      | "MOVE_DOWN"
      | "MOVE_LEFT"
      | "MOVE_RIGHT"
      | "MOVE_UP_FAST"
      | "MOVE_DOWN_FAST"
      | "MOVE_LEFT_FAST"
      | "MOVE_RIGHT_FAST";
    id: number;
  } | null;
}

export interface EditorPreferencesState {
  penStyle: PenStyle;
  highlightStyle?: PenStyle;
  commentStyle?: { color: string; opacity: number };
  freetextStyle?: {
    color: string;
    size: number;
    borderColor?: string;
    borderWidth?: number;
  };
  shapeStyle?: {
    color: string;
    thickness: number;
    opacity: number;
    borderStyle?: "solid" | "dashed";
    dashDensity?: number;
    backgroundColor?: string;
    backgroundOpacity?: number;
    arrowSize?: number;
    cloudIntensity?: number;
    cloudSpacing?: number;
  };
  stampStyle?: {
    kind: StampKind;
    presetId?: StampPresetId;
    image?: StampImageResource;
    imageAppearance?: StampImageAppearance;
    opacity: number;
  };
  options: AppOptions;
  llmModelCache: Record<
    AiProviderId,
    {
      models: AppLLMModelOption[];
      fetchedAt?: number;
      configurationKey?: string;
    }
  >;
  translateOption: TranslateOptionId;
  translateTargetLanguage: string | null;
  pageTranslateOptions: PageTranslateOptions;
}

export type SidebarTab = "thumbnails" | "outline" | "fields" | "annotations";
export type RightPanelTab =
  | "document"
  | "properties"
  | "ai_chat"
  | "page_translate";

export interface EditorUiViewState {
  activeDialog: "shortcuts" | "settings" | null;
  isPanelFloating: boolean;
  pageLayout: PageLayoutMode;
  pageFlow: PageFlowDirection;
  isFullscreen: boolean;
  isSidebarOpen: boolean;
  isRightPanelOpen: boolean;
  rightPanelTab: RightPanelTab;
  sidebarTab: SidebarTab;
  sidebarWidth: number;
  rightPanelWidth: number;
}

export interface DocumentResourceState {
  thumbnailImages: Record<number, string>;
  /** Annotation-free reader placeholders; never used as final thumbnails. */
  pagePreviewImages: Record<number, string>;
}

export type EditorState = DocumentState &
  EditorPreferencesState &
  EditorUiViewState &
  DocumentResourceState;

// Workspace rendering only needs a focused subset of the editor state.
// Keeping this hot-path contract explicit helps us avoid subscribing the
// zoom/pan canvas to unrelated editor updates.
export type WorkspaceEditorState = Pick<
  EditorState,
  | "annotations"
  | "commentStyle"
  | "documentLoadState"
  | "documentPermissions"
  | "fields"
  | "freetextStyle"
  | "highlightStyle"
  | "keys"
  | "mode"
  | "options"
  | "pageFlow"
  | "pageLayout"
  | "pages"
  | "pageTranslateOptions"
  | "pageTranslateParagraphCandidates"
  | "pageTranslateSelectedParagraphIds"
  | "penStyle"
  | "pendingViewStateRestore"
  | "shapeStyle"
  | "stampStyle"
  | "scale"
  | "viewRotation"
  | "selectedId"
  | "selectedControlIds"
  | "tool"
>;

// The canvas shell needs a few extra viewport/layout fields around the
// workspace state for fit-scale calculations and chrome controls.
export type EditorCanvasState = WorkspaceEditorState &
  Pick<
    EditorState,
    "currentPageIndex" | "filename" | "fitTrigger" | "isFullscreen" | "pdfBytes"
  >;

export type EditorUiState = Pick<
  EditorState,
  | "isSidebarOpen"
  | "isRightPanelOpen"
  | "rightPanelTab"
  | "sidebarTab"
  | "pageLayout"
  | "pageFlow"
  | "sidebarWidth"
  | "rightPanelWidth"
  | "translateOption"
  | "translateTargetLanguage"
  | "pageTranslateOptions"
  | "options"
>;
