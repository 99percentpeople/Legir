/** Shared PDF/editor data contracts. No UI, persistence or AI dependencies. */
import type { StampKind, StampPresetId } from "./stamps.js";

export enum FieldType {
  TEXT = "Text",
  CHECKBOX = "Checkbox",
  RADIO = "Radio",
  DROPDOWN = "Dropdown",
  BUTTON = "Button",
  SIGNATURE = "Signature",
}

export type EditorMode = "form" | "annotation" | "pages";

export type PageLayoutMode = "single" | "double_even" | "double_odd";

export type PageFlowDirection = "vertical" | "horizontal";

export type ThumbnailsLayoutMode = "single" | "double";

export type Tool =
  // Common
  | "select"
  | "select_text"
  | "pan"
  // Form Tools
  | "draw_text"
  | "draw_checkbox"
  | "draw_radio"
  | "draw_dropdown"
  | "draw_button"
  | "draw_signature"
  // Annotation Tools
  | "draw_highlight"
  | "draw_ink"
  | "draw_comment"
  | "draw_freetext"
  | "draw_stamp"
  | "draw_shape_rect"
  | "draw_shape_ellipse"
  | "draw_shape_line"
  | "draw_shape_polyline"
  | "draw_shape_polygon"
  | "draw_shape_cloud_polygon"
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
  /** PDF choice presentation: list box when true, combo box otherwise.
   * Legacy models with isMultiSelect=true are also treated as list boxes. */
  isListBox?: boolean;
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

  // Standard pushbutton caption/icon settings (/MK), independent of signature values.
  buttonCaption?: string;
  buttonLayout?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** undefined retains the native icon; null explicitly clears it. Only PNG/JPEG data URLs are accepted. */
  buttonImage?: string | null;
  buttonImageFit?: {
    scaleMode: "contain" | "fill";
    alignment: [number, number];
    when: "always" | "bigger" | "smaller" | "never";
    fitBounds: boolean;
  };
  /** Import-only preview. Export retains the original (possibly vector) icon unless explicitly replaced. */
  buttonIconPreview?: string;
  sourceAppearance?: string;
  sourceAppearanceKey?: string;
  /** Signature dictionary metadata, NOT a certificate-verification result. Never exported as a new signature. */
  signature?: {
    present: boolean;
    name?: string;
    reason?: string;
    location?: string;
    date?: string;
  };

  // Extended properties
  toolTip?: string;
  readOnly?: boolean;
  multiline?: boolean; // For Text
  maxLength?: number; // For Text
  alignment?: "left" | "center" | "right"; // For Text
  /** Text block placement. Omit to retain legacy single-line/multiline layout. */
  verticalAlignment?: "top" | "middle" | "bottom";
  rotationDeg?: number;
  sourcePdfRef?: { objectNumber: number; generationNumber: number };
}

export interface Annotation {
  id: string;
  pageIndex: number;
  layerOrder?: number;
  type:
    | "highlight"
    | "ink"
    | "comment"
    | "freetext"
    | "link"
    | "shape"
    | "stamp";
  rect?: { x: number; y: number; width: number; height: number }; // For highlight / comment bounds
  rects?: { x: number; y: number; width: number; height: number }[]; // For multi-rect highlights
  points?: { x: number; y: number }[]; // For ink
  strokes?: { x: number; y: number }[][]; // For ink (multi-stroke)
  text?: string; // For comment
  highlightedText?: string; // Source text covered by a text highlight
  author?: string; // Creator/Author of the annotation
  color?: string;
  backgroundColor?: string;
  backgroundOpacity?: number;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed" | "underline";
  dashDensity?: number;
  opacity?: number; // For highlight
  thickness?: number; // For ink
  size?: number; // For text
  lineHeight?: number;
  /** FreeText insets from the outer box, in points (including the border). */
  textPadding?:
    | number
    | { top: number; right: number; bottom: number; left: number };
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
  stamp?: AnnotationStampData;
  shapeType?:
    | "square"
    | "circle"
    | "line"
    | "polyline"
    | "polygon"
    | "cloud_polygon"
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
  replies?: AnnotationReply[];
  isEdited?: boolean;
}

export interface AnnotationReply {
  id: string;
  // The owning thread stays flat for the comments panel.
  parentAnnotationId: string;
  // Immediate reply parent, when /IRT points to another reply in this thread.
  inReplyToReplyId?: string;
  text?: string;
  author?: string;
  updatedAt?: string;
  sourcePdfRef?: { objectNumber: number; generationNumber: number };
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
  documentPermissions?: PDFDocumentPermissions | null;
}

export interface PDFDocumentPermissions {
  isEncrypted: boolean;
  hasOwnerRestrictions: boolean;
  canOpen: boolean;
  canModifyContents: boolean;
  canModifyAnnotations: boolean;
  canFillForms: boolean;
  canCopy: boolean;
  canCopyForAccessibility: boolean;
  canPrint: boolean;
  canPrintHighQuality: boolean;
  canAssemble: boolean;
  rawFlags: number[] | null;
}

export interface PDFPermissionDirtyScopes {
  assemble?: boolean;
  modifyContents: boolean;
  modifyAnnotations: boolean;
  fillForms: boolean;
}

export interface PDFOutlineItem {
  title: string;
  items: PDFOutlineItem[];
  pageIndex?: number;
}

export interface PageData {
  /** Stable identity; absent on legacy snapshots until the first structural edit. */
  id?: string;
  source?: { documentId: string; pageIndex: number; copyGroup?: string };
  blank?: boolean;
  /** Saved page rotation, relative to the source viewport used by controls. */
  rotationDelta?: number;
  pageIndex: number;
  width: number;
  height: number;
  viewBox: [number, number, number, number];
  userUnit: number;
  rotation: number;
}

export interface PageSource {
  /** Original file indexes represented by this compact native source. */
  pageIndexes?: number[];
  bytes: Uint8Array;
  password: string | null;
  filename: string;
}

export interface HistorySnapshot {
  pages?: PageData[];
  pageSources?: Record<string, PageSource>;
  preservedSourceAnnotations?: PreservedSourceAnnotationRef[];
  outline?: PDFOutlineItem[];
  selectedPageIds?: string[];
  currentPageIndex?: number;
  fields: FormField[];
  annotations: Annotation[];
  metadata: PDFMetadata;
  exportPassword: string | null;
  dirtyPermissionScopes: PDFPermissionDirtyScopes;
}

export interface PreservedSourceAnnotationRef {
  pageIndex: number;
  sourcePdfRef: { objectNumber: number; generationNumber: number };
  subtype?: string;
}

export type StampImageFrame = "plain" | "card";

export type StampAppearanceSource = "native" | "baked";

export interface StampIntrinsicSize {
  width: number;
  height: number;
}

export interface StampNormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StampImageResource {
  dataUrl: string;
  intrinsicSize?: StampIntrinsicSize;
}

export interface StampImageAppearance {
  frame?: StampImageFrame;
  scaleMode?: "contain" | "fill";
  box?: StampNormalizedBox;
  source?: StampAppearanceSource;
}

export interface AnnotationStampData {
  kind: StampKind;
  presetId?: StampPresetId;
  label?: string;
  image?: StampImageResource;
  appearance?: StampImageAppearance;
}

export interface ImageCompressionOptions {
  mode: "original" | "dpi";
  dpi: number;
}

export type TranslateOptionId = `${string}:${string}`;

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
  matchText: string;
  contextBefore: string;
  contextAfter: string;
  displaySegments: PDFSearchDisplaySegment[];
}
