/** Engine-independent text-layer contract, in original PDF user coordinates. */
export interface TextItem {
  str: string;
  dir: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

export interface TextMarkedContent {
  type: string;
  id: string;
}
export interface TextStyle {
  ascent: number;
  descent: number;
  vertical: boolean;
  fontFamily: string;
}
export interface TextContent {
  items: (TextItem | TextMarkedContent)[];
  styles: Record<string, TextStyle>;
  lang: string | null;
}
