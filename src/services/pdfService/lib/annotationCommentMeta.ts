import { PDFDict, PDFHexString, PDFName, PDFString } from "@cantoo/pdf-lib";
import { Annotation, AnnotationReply } from "@/types";
import { parsePDFDate } from "@/utils/pdfUtils";
import { PdfJsAnnotation } from "../types";
import { decodePdfString } from "./pdf-objects";

export interface AnnotationCommentMeta {
  text?: string;
  author?: string;
  updatedAt?: string;
}

const normalizeOptionalString = (value: string | null | undefined) => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
};

const getPreferredContentsText = (value: string | null | undefined) => {
  if (typeof value !== "string") return undefined;
  return value.trim() ? value : undefined;
};

export const stripPdfRichTextToPlainText = (input: string) => {
  const withoutTags = input.replace(/<[^>]*>/g, " ");
  return withoutTags.replace(/\s+/g, " ").trim();
};

export const extractAnnotationCommentText = (source: {
  contents?: string | null;
  richText?: string | null;
}) => {
  const contents = getPreferredContentsText(source.contents);
  if (contents) return contents;

  const richText = normalizeOptionalString(source.richText);
  if (!richText) return undefined;

  const normalized = stripPdfRichTextToPlainText(richText);
  return normalized || undefined;
};

export const readPdfJsAnnotationCommentMeta = (
  annotation: Pick<
    PdfJsAnnotation,
    "contents" | "richText" | "title" | "modificationDate"
  >,
): AnnotationCommentMeta => ({
  text: extractAnnotationCommentText(annotation),
  author: normalizeOptionalString(annotation.title),
  updatedAt: parsePDFDate(annotation.modificationDate),
});

export const readPdfDictAnnotationCommentMeta = (
  annotation: PDFDict,
): AnnotationCommentMeta => {
  const contents = decodePdfString(annotation.lookup(PDFName.of("Contents")));
  const richText = decodePdfString(annotation.lookup(PDFName.of("RC")));
  const author = decodePdfString(annotation.lookup(PDFName.of("T")));
  const modifiedAt = decodePdfString(annotation.lookup(PDFName.of("M")));

  return {
    text: extractAnnotationCommentText({ contents, richText }),
    author: normalizeOptionalString(author),
    updatedAt: parsePDFDate(modifiedAt),
  };
};

const setOptionalDictValue = (
  annotation: PDFDict,
  key: string,
  value: PDFHexString | PDFString | undefined,
) => {
  const name = PDFName.of(key);
  if (value === undefined) {
    annotation.delete(name);
    return;
  }

  annotation.set(name, value);
};

export const applyPdfAnnotationCommentMetadata = (
  annotation: PDFDict,
  meta: Pick<Annotation, "text" | "author" | "updatedAt"> &
    Partial<Pick<AnnotationReply, "text" | "author" | "updatedAt">>,
) => {
  const text =
    typeof meta.text === "string" && meta.text.length > 0
      ? meta.text
      : undefined;
  const author = normalizeOptionalString(meta.author);

  setOptionalDictValue(
    annotation,
    "Contents",
    text ? PDFHexString.fromText(text) : undefined,
  );
  setOptionalDictValue(
    annotation,
    "T",
    author ? PDFHexString.fromText(author) : undefined,
  );
  setOptionalDictValue(
    annotation,
    "M",
    meta.updatedAt
      ? PDFString.fromDate(new Date(meta.updatedAt))
      : PDFString.fromDate(new Date()),
  );
};
