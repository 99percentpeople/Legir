export type Matrix = [number, number, number, number, number, number];
export type Rect = [number, number, number, number];
export type Quad = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export interface Glyph {
  text: string;
  origin: [number, number];
  quad: Quad;
  fontName: string;
  fontSize: number;
  color: number[];
}
export interface PageText {
  text: string;
  lines: { writingMode: number; glyphs: Glyph[] }[];
}
export interface RenderOptions {
  contents?: boolean;
  annotations?: boolean;
  keepAnnotations?: Set<number>;
  transparent?: boolean;
  /** Reuse decoded images without filling/evicting the large-image cache. */
  imageCache?: "populate" | "reuse";
}
export interface SaveOptions {
  encrypt?: "none" | "aes-256";
  "user-password"?: string;
  "owner-password"?: string;
  permissions?: number;
}
export interface GraftOptions {
  /** Clone objects even when source and target are the same document. */
  copyWithinDocument?: boolean;
  /** Materialize inherited page attributes and omit page Parent references. */
  copyPages?: boolean;
}
export enum ObjectType {
  Boolean = 1,
  Number = 2,
  String = 3,
  Name = 4,
  Array = 5,
  Dictionary = 6,
  Stream = 7,
  Null = 8,
  Reference = 9,
}
export interface OutlineItem {
  title: string;
  page?: number;
  uri?: string;
  down?: OutlineItem[];
}
export type NativeModule = {
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
} & Record<`_${string}`, (...args: number[]) => number>;
export interface LoadOptions {
  moduleUrl?: string;
  wasmBinary?: Uint8Array;
  locateFile?: (file: string) => string;
}
