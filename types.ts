
export enum FieldType {
  TEXT = 'Text',
  CHECKBOX = 'Checkbox',
  RADIO = 'Radio',
  DROPDOWN = 'Dropdown',
}

export interface FieldStyle {
  borderColor?: string; // Hex
  backgroundColor?: string; // Hex
  borderWidth?: number;
  textColor?: string; // Hex
  fontSize?: number;
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
  style?: FieldStyle;
  // Specific properties
  options?: string[]; // For Dropdown
  radioValue?: string; // For Radio Button (the value when selected)

  // Extended properties
  toolTip?: string;
  readOnly?: boolean;
  multiline?: boolean; // For Text
  isChecked?: boolean; // For Checkbox/Radio default
  maxLength?: number; // For Text
  alignment?: 'left' | 'center' | 'right'; // For Text
}

export interface PDFMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
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
  imageData: string; // Base64 string of the rendered page
}

export interface HistorySnapshot {
  fields: FormField[];
  metadata: PDFMetadata;
}

export interface SnappingOptions {
  enabled: boolean;
  snapToBorders: boolean;
  snapToCenter: boolean;
  snapToEqualDistances: boolean;
  threshold: number;
}

export interface EditorState {
  pdfFile: File | null;
  pdfBytes: Uint8Array | null;
  metadata: PDFMetadata;
  filename: string;
  pages: PageData[];
  fields: FormField[];
  outline: PDFOutlineItem[];
  selectedFieldId: string | null;
  scale: number;
  tool: 'select' | 'draw_text' | 'draw_checkbox' | 'draw_radio' | 'draw_dropdown';
  isProcessing: boolean;
  // History Stacks
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  // Clipboard
  clipboard: FormField | null;
  // Settings
  snappingOptions: SnappingOptions;
}
