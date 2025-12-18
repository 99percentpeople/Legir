import * as pdfjsLib from "pdfjs-dist";
import { PDFDocument, PDFForm, PDFPage, type PDFFont } from "pdf-lib";
import { Annotation, FormField } from "../../types";

export type PdfJsAnnotationOption =
  | string
  | {
      display?: string;
      exportValue?: string;
    };

export type PdfJsAnnotation = Record<string, unknown> & {
  subtype: string;
  rect: [number, number, number, number];

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
  };
  defaultAppearance?: string;
  DA?: string;
  textAlignment?: number;

  checkBox?: boolean;
  radioButton?: boolean;
  buttonValue?: string;

  title?: string;
  contents?: string;
  modificationDate?: string;
  quadPoints?: number[];
  opacity?: number;
};

export interface ParserContext {
  pageAnnotations: PdfJsAnnotation[];
  pageIndex: number;
  viewport: pdfjsLib.PageViewport;
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
    viewport?: pdfjsLib.PageViewport,
  ): Promise<void> | void;
}

export interface IControlExporter {
  shouldExport(field: FormField): boolean;
  save(
    form: PDFForm,
    field: FormField,
    fontMap?: Map<string, PDFFont>,
    viewport?: pdfjsLib.PageViewport,
  ): Promise<void> | void;
}
