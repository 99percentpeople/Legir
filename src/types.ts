/**
 * Core editor domain types shared across the app.
 *
 * This file is the main contract for document-facing models such as fields,
 * annotations, editor tools, document snapshots, and workspace state.
 * Keep service-local or feature-local types in a nearby `types.ts` instead of
 * growing this file with implementation-specific details.
 */
import type { AiProviderId } from "@/services/ai/sdk/providerCatalog";

export enum FieldType {
  TEXT = "Text",
  CHECKBOX = "Checkbox",
  RADIO = "Radio",
  DROPDOWN = "Dropdown",
  SIGNATURE = "Signature",
}

export type EditorMode = "form" | "annotation";

export type PageLayoutMode = "single" | "double_even" | "double_odd";

export type PageFlowDirection = "vertical" | "horizontal";

export type ThumbnailsLayoutMode = "single" | "double";

export type Tool =
  // Common
  | "select"
  | "pan"
  // Form Tools
  | "draw_text"
  | "draw_checkbox"
  | "draw_radio"
  | "draw_dropdown"
  | "draw_signature"
  // Annotation Tools
  | "draw_highlight"
  | "draw_ink"
  | "draw_comment"
  | "draw_freetext"
  | "draw_shape_rect"
  | "draw_shape_ellipse"
  | "draw_shape_line"
  | "draw_shape_polyline"
  | "draw_shape_polygon"
  | "draw_shape_arrow"
  | "draw_shape_cloud"
  | "eraser";

export type MoveDirection = "UP" | "DOWN" | "LEFT" | "RIGHT";
export type ControlLayerMove =
  | "bring_forward"
  | "send_backward"
  | "bring_to_front"
  | "send_to_back";

export interface FieldStyle {
  borderColor?: string; // Hex
  backgroundColor?: string; // Hex
  borderWidth?: number;
  borderStyle?: "solid" | "dashed" | "underline";
  textColor?: string; // Hex
  fontSize?: number;
  fontFamily?: string; // Font Family Name
  isTransparent?: boolean;
}

export interface FormField {
  id: string;
  pageIndex: number;
  layerOrder?: number;
  type: FieldType;
  name: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  required?: boolean;
  isMultiSelect?: boolean;
  allowCustomValue?: boolean;
  style?: FieldStyle;

  // Value & Defaults
  value?: string; // Current Text / Selected Dropdown Option
  defaultValue?: string; // Default Text / Default Dropdown Option
  placeholder?: string;

  isChecked?: boolean; // Current Checkbox/Radio state
  isDefaultChecked?: boolean; // Default Checkbox/Radio state

  exportValue?: string; // Export value for Checkbox (defaults to Yes) or Radio (alias for radioValue)

  // Specific properties
  options?: string[]; // For Dropdown
  radioValue?: string; // For Radio Button (legacy/alias for exportValue)

  // Signature specific
  signatureData?: string; // Base64 image data
  imageScaleMode?: "contain" | "fill"; // Scaling mode for signature images

  // Extended properties
  toolTip?: string;
  readOnly?: boolean;
  multiline?: boolean; // For Text
  maxLength?: number; // For Text
  alignment?: "left" | "center" | "right"; // For Text
}

export interface Annotation {
  id: string;
  pageIndex: number;
  layerOrder?: number;
  type: "highlight" | "ink" | "comment" | "freetext" | "link" | "shape";
  rect?: { x: number; y: number; width: number; height: number }; // For highlight / comment bounds
  rects?: { x: number; y: number; width: number; height: number }[]; // For multi-rect highlights
  points?: { x: number; y: number }[]; // For ink
  strokes?: { x: number; y: number }[][]; // For ink (multi-stroke)
  text?: string; // For comment
  highlightedText?: string; // Source text covered by a text highlight
  author?: string; // Creator/Author of the annotation
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  opacity?: number; // For highlight
  thickness?: number; // For ink
  size?: number; // For text
  lineHeight?: number;
  fontFamily?: string; // For text
  rotationDeg?: number;
  alignment?: "left" | "center" | "right"; // For comment text alignment
  subtype?: string; // To preserve original PDF subtype
  intent?: string; // For PDF Intent (IT), e.g., "InkHighlight"
  updatedAt?: string; // ISO Date string for modification date
  svgPath?: string; // Imported appearance path data
  appearanceStreamContent?: string; // Raw PDF appearance stream operators
  linkUrl?: string;
  linkDestPageIndex?: number;
  flatten?: boolean;
  shapeType?:
    | "square"
    | "circle"
    | "line"
    | "polyline"
    | "polygon"
    | "arrow"
    | "cloud";
  shapePoints?: { x: number; y: number }[];
  shapeStartArrow?: boolean;
  shapeEndArrow?: boolean;
  shapeStartArrowStyle?:
    | "closed_arrow"
    | "line_arrow"
    | "hollow_arrow"
    | "circle"
    | "square"
    | "diamond"
    | "slash";
  shapeEndArrowStyle?:
    | "closed_arrow"
    | "line_arrow"
    | "hollow_arrow"
    | "circle"
    | "square"
    | "diamond"
    | "slash";
  arrowSize?: number;
  cloudIntensity?: number;
  cloudSpacing?: number;

  meta?:
    | {
        kind: "page_translate";
        source: "text_layer" | "ocr";
        granularity?: "line" | "paragraph";
        targetLanguage: string;
        sourceLanguage?: string;
        translateOption?: TranslateOptionId;
        prompt?: string;
        createdAt: string;
      }
    | { kind: string; [key: string]: unknown };

  sourcePdfRef?: { objectNumber: number; generationNumber: number };
  sourcePdfFontName?: string;
  sourcePdfFontIsSubset?: boolean;
  sourcePdfFontMissing?: boolean;
  isEdited?: boolean;
}

export interface PDFMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string | string[];
  creator?: string;
  producer?: string;
  creationDate?: string;
  modificationDate?: string;
  isModDateManual?: boolean;
  isProducerManual?: boolean;
}

export interface PDFOutlineItem {
  title: string;
  items: PDFOutlineItem[];
  pageIndex?: number;
}

export interface PageData {
  pageIndex: number;
  width: number;
  height: number;
  viewBox: [number, number, number, number];
  userUnit: number;
  rotation: number;
}

export interface HistorySnapshot {
  fields: FormField[];
  annotations: Annotation[];
  metadata: PDFMetadata;
  exportPassword: string | null;
}

export type EditorSaveTarget =
  | { kind: "web"; handle: FileSystemFileHandle }
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
}

export type AppLLMModelOption = {
  id: string;
  label: string;
  labelKey?: string;
  capabilities: LLMModelCapabilities;
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
}

export type LLMCustomModelCapability = "text" | "image" | "tools";

export interface LLMCustomModelConfig {
  id: string;
  capabilities: LLMCustomModelCapability[];
}

export interface LLMProviderOptions {
  apiKey?: string;
  apiUrl?: string;
  customModels: LLMCustomModelConfig[];
}

export type LLMOptions = Record<AiProviderId, LLMProviderOptions>;

export interface AiChatOptions {
  digestEnabled: boolean;
  digestSourceCharsPerChunk: number;
  digestOutputRatioDenominator: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  digestSummaryModelKey?: string;
}

export interface AppOptions {
  snappingOptions: SnappingOptions;
  debugOptions: DebugOptions;
  userName: string;
  thumbnailsLayout: ThumbnailsLayoutMode;
  removeTextUnderFlattenedFreetext: boolean;

  llm: LLMOptions;
  aiChat: AiChatOptions;
}

export interface PenStyle {
  color: string;
  thickness: number;
  opacity: number;
}

export type DialogName = "shortcuts" | "settings" | "close_confirm" | null;

export type TranslateOptionId = `${string}:${string}`;

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

export interface PDFSearchDisplaySegment {
  text: string;
  highlighted: boolean;
}

export interface PDFSearchResult {
  id: string;
  pageIndex: number;
  matchIndexOnPage: number;
  startOffset: number;
  endOffset: number;
  sortTop: number;
  sortLeft: number;
  rect: { x: number; y: number; width: number; height: number };
  rects: { x: number; y: number; width: number; height: number }[];
  matchText: string;
  contextBefore: string;
  contextAfter: string;
  displaySegments: PDFSearchDisplaySegment[];
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

export interface EditorState {
  // Document State
  pdfFile: File | null;
  pdfBytes: Uint8Array | null;
  pdfOpenPassword: string | null;
  exportPassword: string | null;
  metadata: PDFMetadata;
  filename: string;
  saveTarget: EditorSaveTarget | null;
  pages: PageData[];
  thumbnailImages: Record<number, string>;
  fields: FormField[];
  annotations: Annotation[];
  outline: PDFOutlineItem[];

  mode: EditorMode;
  tool: Tool;

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
    backgroundColor?: string;
    arrowSize?: number;
    cloudIntensity?: number;
    cloudSpacing?: number;
  };

  selectedId: string | null;

  scale: number;
  isProcessing: boolean;

  // History Stacks
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  // Clipboard
  clipboard: {
    type: "field" | "annotation";
    data: FormField | Annotation;
  } | null;
  // Settings
  options: AppOptions;

  llmModelCache: Record<
    AiProviderId,
    {
      translateModels: AppLLMModelOption[];
      visionModels: AppLLMModelOption[];
    }
  >;

  // Translate (UI preference)
  translateOption: TranslateOptionId;
  translateTargetLanguage: string | null;

  pageTranslateOptions: PageTranslateOptions;

  pageTranslateParagraphCandidates: PageTranslateParagraphCandidate[];
  pageTranslateSelectedParagraphIds: string[];

  // Dialog State
  activeDialog: "shortcuts" | "settings" | "close_confirm" | null;
  closeConfirmSource: "menu" | "window" | null;

  // Status
  lastSavedAt: Date | null;

  // UI State
  processingStatus: string | null;
  isPanelFloating: boolean;
  isSaving: boolean;
  pageLayout: PageLayoutMode;
  pageFlow: PageFlowDirection;
  isFullscreen: boolean;
  isSidebarOpen: boolean;
  isRightPanelOpen: boolean;
  rightPanelTab: string;
  rightPanelDockTab: string[];
  sidebarTab: string;
  hasSavedSession: boolean;
  isDirty: boolean;
  currentPageIndex: number;
  pendingViewStateRestore: {
    scale: number;
    scrollLeft: number;
    scrollTop: number;
  } | null;
  sidebarWidth: number;
  rightPanelWidth: number;
  fitTrigger: number;

  // Keyboard State
  keys: {
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
    space: boolean;
  };

  // Command Signal
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

// Workspace rendering only needs a focused subset of the editor state.
// Keeping this hot-path contract explicit helps us avoid subscribing the
// zoom/pan canvas to unrelated editor updates.
export type WorkspaceEditorState = Pick<
  EditorState,
  | "annotations"
  | "commentStyle"
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
  | "scale"
  | "selectedId"
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
  | "rightPanelDockTab"
>;
