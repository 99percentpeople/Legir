import { PDFDocument, PDFForm, PDFPage } from "pdf-lib";
import { Annotation, FormField } from "../../types";

export interface ParserContext {
  pageAnnotations: any[];
  pageIndex: number;
  viewport: any;
  pdfDoc?: PDFDocument;
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
    fontMap?: Map<string, any>,
  ): Promise<void> | void;
}

export interface IControlExporter {
  shouldExport(field: FormField): boolean;
  save(
    form: PDFForm,
    field: FormField,
    fontMap?: Map<string, any>,
  ): Promise<void> | void;
}
