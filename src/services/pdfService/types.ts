import { PDFDocument, PDFForm, PDFPage, type PDFFont } from "@cantoo/pdf-lib";
import { Annotation, FormField } from "@/types";

// [x, y, width, height]
export type Tile = [number, number, number, number];

export type PdfJsAnnotationOption =
  | string
  | {
      display?: string;
      exportValue?: string;
    };

export type PdfJsAnnotation = Record<string, unknown> & {
  subtype: string;
  rect: [number, number, number, number];

  sourcePdfRef?: { objectNumber: number; generationNumber: number };

  fieldName?: string;
  fieldType?: string;
  fieldFlags?: number;
  fieldValue?: unknown;
  alternativeText?: string;
  options?: PdfJsAnnotationOption[];

  color?: number[] | Uint8ClampedArray;
  backgroundColor?: number[] | Uint8ClampedArray;
  borderStyle?: {
    width?: number;
    style?: "solid" | "dashed" | "underline";
  };
  defaultAppearance?: string;
  DA?: string;
  textAlignment?: number;

  checkBox?: boolean;
  radioButton?: boolean;
  buttonValue?: string;

  title?: string;
  contents?: string;
  richText?: string;
  modificationDate?: string;
  quadPoints?: number[];
  opacity?: number;
  url?: string;
  unsafeUrl?: string;
  dest?: unknown;
  destPageIndex?: number | null;
};

export type ViewportLike = {
  viewBox?: [number, number, number, number];
  userUnit?: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  transform: [number, number, number, number, number, number];
  offsetX: number;
  offsetY: number;
  convertToViewportPoint: (x: number, y: number) => [number, number];
  convertToPdfPoint: (x: number, y: number) => [number, number];
};

export interface ParserContext {
  pageAnnotations: PdfJsAnnotation[];
  pageIndex: number;
  viewport: ViewportLike;
  pdfDoc?: PDFDocument;
  fontMap?: Map<string, string>;
  globalDA?: string;
  embeddedFontCache?: Map<string, Promise<string | undefined>>;
  embeddedFontFaces?: Set<FontFace>;
}

export interface IAnnotationParser {
  parse(context: ParserContext): Promise<Annotation[]> | Annotation[];
}

export interface IControlParser {
  parse(context: ParserContext): Promise<FormField[]> | FormField[];
}

export interface IAnnotationExporter {
  shouldExport(annotation: Annotation): boolean;
  save(
    pdfDoc: PDFDocument,
    page: PDFPage,
    annotation: Annotation,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
  ): Promise<void> | void;
}

export interface IControlExporter {
  shouldExport(field: FormField): boolean;
  save(
    form: PDFForm,
    field: FormField,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
  ): Promise<void> | void;
}
