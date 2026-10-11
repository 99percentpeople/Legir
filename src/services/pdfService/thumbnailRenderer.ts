import {
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MIME_TYPE,
  THUMBNAIL_TARGET_WIDTH,
} from "@/constants";
import type { PDFWorkerService } from "./pdfWorkerService";
import type { ThumbnailContent } from "./types";
import type {
  PageData,
  FormField,
  Annotation,
  PreservedSourceAnnotationRef,
} from "@/types";

/** Bucket controls once; importing thousands of pages must not repeatedly filter them. */
export function getThumbnailContents(document: {
  pages: PageData[];
  fields: FormField[];
  annotations: Annotation[];
  preservedSourceAnnotations: PreservedSourceAnnotationRef[];
}): ThumbnailContent[] {
  const pages: ThumbnailContent[] = document.pages.map((page) => ({
    width: page.width,
    height: page.height,
    fields: [],
    annotations: [],
    preserved: [],
  }));
  for (const field of document.fields)
    pages[field.pageIndex]?.fields.push(field);
  for (const annotation of document.annotations)
    pages[annotation.pageIndex]?.annotations.push(annotation);
  for (const preserved of document.preservedSourceAnnotations)
    pages[preserved.pageIndex]?.preserved.push(preserved);
  return pages;
}

/** One raster/encoding path for document thumbnails and read-only import previews. */
export async function renderThumbnail(
  worker: PDFWorkerService,
  pageIndex: number,
  signal: AbortSignal,
  content?: ThumbnailContent,
  priority = 20,
) {
  const result = await worker.renderPageImage({
    pageIndex,
    signal,
    priority,
    targetWidth: THUMBNAIL_TARGET_WIDTH,
    mimeType: THUMBNAIL_MIME_TYPE,
    quality: THUMBNAIL_JPEG_QUALITY,
    renderAnnotations: true,
    thumbnailContent: content,
  });
  signal.throwIfAborted();
  if (!result.bytes.length) throw new Error("Empty thumbnail");
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(result.bytes)], { type: result.mimeType }),
  );
  try {
    // Decode before publishing: existing <img> nodes keep their old bitmap
    // throughout regeneration and never pass through an empty/loading state.
    const image = new Image();
    image.src = url;
    await image.decode();
    signal.throwIfAborted();
    return url;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
