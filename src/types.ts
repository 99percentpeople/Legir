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
  | "eraser";

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
  style?: FieldStyle;

  // Value & Defaults
  value?: string; // Current Text / Selected Dropdown Option
  defaultValue?: string; // Default Text / Default Dropdown Option

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
  type: "highlight" | "ink" | "comment" | "freetext" | "link";
  rect?: { x: number; y: number; width: number; height: number }; // For highlight / comment bounds
  rects?: { x: number; y: number; width: number; height: number }[]; // For multi-rect highlights
  points?: { x: number; y: number }[]; // For ink
  strokes?: { x: number; y: number }[][]; // For ink (multi-stroke)
  text?: string; // For comment
  author?: string; // Creator/Author of the annotation
  color?: string;
  backgroundColor?: string;
  opacity?: number; // For highlight
  thickness?: number; // For ink
  size?: number; // For text
  fontFamily?: string; // For text
  alignment?: "left" | "center" | "right"; // For comment text alignment
  subtype?: "ink" | "polyline" | "line"; // To preserve original PDF subtype
  intent?: string; // For PDF Intent (IT), e.g., "InkHighlight"
  updatedAt?: string; // ISO Date string for modification date
  svgPath?: string; // Imported appearance path data
  appearanceStreamContent?: string; // Raw PDF appearance stream operators
  linkUrl?: string;
  linkDestPageIndex?: number;

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
  imageData?: string; // Base64 string (Optional now, used for lazy loading fallback)
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
}

export interface EditorOptions {
  snappingOptions: SnappingOptions;
  debugOptions: DebugOptions;
  userName: string;
  thumbnailsLayout: ThumbnailsLayoutMode;
}

export interface PenStyle {
  color: string;
  thickness: number;
  opacity: number;
}

export type DialogName = "shortcuts" | "settings" | "close_confirm" | null;

export type TranslateOptionId = `${string}:${string}`;

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
  fields: FormField[];
  annotations: Annotation[];
  outline: PDFOutlineItem[];

  mode: EditorMode;
  tool: Tool;

  penStyle: PenStyle;
  highlightStyle?: PenStyle;
  commentStyle?: { color: string; opacity: number };
  freetextStyle?: { color: string; size: number };

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
  options: EditorOptions;

  // Translate (UI preference)
  translateOption: TranslateOptionId;
  translateTargetLanguage: string | null;

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
  | "options"
  | "rightPanelDockTab"
>;
