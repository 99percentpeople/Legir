import {
  loadEditingDocument,
  disposeEditingDocument,
  renderEditingAnnotations,
} from "../engine/editingDocument.js";
import type { PdfHydrationServices } from "../host.js";
import { getFontMap, getGlobalDA } from "../lib/appearance.js";
import { getSystemFontCatalog } from "../host.js";
import { createPdfStreamTextReader } from "../lib/pdf-import-utils.js";
import { createRenderedPageImageCropper } from "../lib/renderedImageCrop.js";
import { attachAnnotationReplies } from "../lib/annotationReplies.js";
import { PDFDocument } from "@legir/pdfium/authoring";
import { pdfDebug } from "../lib/debug.js";
import { UNRESTRICTED_PDF_PERMISSIONS } from "@legir/pdf-model/pdfPermissions";
import {
  createStampImageAppearance,
  createStampImageResource,
} from "@legir/pdf-model/stampImage";
import {
  FormField,
  PageData,
  PDFDocumentPermissions,
  PDFMetadata,
  PDFOutlineItem,
  Annotation,
  PreservedSourceAnnotationRef,
} from "@legir/pdf-model";
import { applyImportedControlLayerOrders } from "../lib/annotation-layer-order.js";
import {
  IAnnotationParser,
  IControlParser,
  ParserContext,
  ViewportLike,
} from "../types.js";
import type { PdfJsAnnotation } from "../types.js";
import {
  InkParser,
  HighlightParser,
  CommentParser,
  FreeTextParser,
  LinkParser,
  StampParser,
  ShapeParser,
} from "../parsers/AnnotationParsers.js";
import {
  TextControlParser,
  CheckboxControlParser,
  RadioControlParser,
  DropdownControlParser,
  SignatureControlParser,
  ButtonControlParser,
} from "../parsers/ControlParsers.js";
import { createPdfLibViewport, pdfJsRectToUiRect } from "../lib/coords.js";
import {
  resolveReadableStampLabel,
  resolveStampPresetIdFromText,
} from "@legir/pdf-model/stamps";
import type { PdfLoadSession } from "./loadSession.js";
import { createPdfLoadSession } from "./loadSession.js";
import { getPdfPasswordReason } from "./loadSession.js";
import { buildPdfLibAnnotsByPageIndex } from "./annotations.js";
import type { LoadedPdfDocument } from "./types.js";
import type { LoadPDFInternalOptions } from "./types.js";

// PDF pipeline service.
//
// This module is the authoritative boundary for:
// - Loading a PDF (bytes -> authoring model + native worker outline/render)
// - Rendering pages/thumbnails (mostly via worker for responsiveness)
// - Importing existing PDF form fields / annotations into our internal models
// - Exporting internal models back into a new PDF
//
// PDFium owns file parsing, rasterization, text, security and serialization.
// The existing authoring graph/layout helpers preserve form and annotation
// behavior; file I/O goes exclusively through engine/editingDocument.
//
// Extension points:
// - Add a new control/annotation type by implementing a Parser + Exporter and registering it
//   in the arrays below. The rest of the app treats `FormField` / `Annotation` as plain data.

// Register parsers and exporters
export const annotationParsers: IAnnotationParser[] = [
  new InkParser(),
  new HighlightParser(),
  new CommentParser(),
  new FreeTextParser(),
  new LinkParser(),
  new StampParser(),
  new ShapeParser(),
];

export const controlParsers: IControlParser[] = [
  new TextControlParser(),
  new CheckboxControlParser(),
  new RadioControlParser(),
  new DropdownControlParser(),
  new SignatureControlParser(),
  new ButtonControlParser(),
];

export const STAMP_RENDER_FALLBACK_SCALE = 2;

export const populateRenderedStampFallbacksForPage = async (options: {
  pageAnnotations: PdfJsAnnotation[];
  pageIndex: number;
  viewport: ViewportLike;
  workerService: PdfHydrationServices;
  pdfDoc: PDFDocument;
  signal?: AbortSignal;
}) => {
  const {
    pageAnnotations,
    pageIndex,
    viewport,
    workerService,
    pdfDoc,
    signal,
  } = options;
  if (signal?.aborted) return;

  const candidates = pageAnnotations.filter((annotation) => {
    if (annotation.subtype !== "Stamp") return false;
    if (
      typeof annotation.stamp?.image?.dataUrl === "string" &&
      annotation.stamp.image.dataUrl.length > 0
    ) {
      return false;
    }

    const rawName =
      typeof annotation.stamp?.name === "string"
        ? annotation.stamp.name.trim()
        : "";
    const rawContents =
      typeof annotation.contents === "string" ? annotation.contents.trim() : "";
    if (resolveStampPresetIdFromText(rawName, rawContents)) return false;
    if (resolveReadableStampLabel({ name: rawName, contents: rawContents })) {
      return false;
    }

    const rect = pdfJsRectToUiRect(annotation.rect, viewport);
    return (
      [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.x < viewport.width &&
      rect.y < viewport.height &&
      rect.x + rect.width > 0 &&
      rect.y + rect.height > 0
    );
  });

  if (candidates.length === 0) return;

  let renderedPage: { bytes: Uint8Array; mimeType: string } | undefined;
  const nativeStampRenderer = (
    workerService as PdfHydrationServices & {
      renderStampPage?: (
        pageIndex: number,
      ) => Promise<{ bytes: Uint8Array; mimeType: string } | undefined>;
    }
  ).renderStampPage;
  try {
    if (nativeStampRenderer)
      renderedPage = await nativeStampRenderer(pageIndex);
    else
      renderedPage = await renderEditingAnnotations(
        pdfDoc,
        pageIndex,
        STAMP_RENDER_FALLBACK_SCALE,
        signal,
      );
  } catch {
    return;
  }

  if (!renderedPage || renderedPage.bytes.length === 0 || signal?.aborted)
    return;

  const cropper = await createRenderedPageImageCropper({
    bytes: renderedPage.bytes,
    mimeType: renderedPage.mimeType,
    pageWidth: viewport.width,
    pageHeight: viewport.height,
  });
  try {
    // Crop serially so a page with many stamps owns only one temporary canvas
    // at a time, while sharing the decoded page bitmap for the entire batch.
    for (const annotation of candidates) {
      if (signal?.aborted) break;
      const importedRect = pdfJsRectToUiRect(annotation.rect, viewport);
      try {
        const cropped = await cropper.crop(importedRect);
        if (!cropped?.dataUrl) continue;

        annotation.stamp = {
          ...annotation.stamp,
          image: createStampImageResource({
            dataUrl: cropped.dataUrl,
            width: cropped.width,
            height: cropped.height,
          }),
          appearance: createStampImageAppearance({
            frame: "plain",
            source: "baked",
          }),
        };
      } catch {
        // One failed crop must not prevent other stamps from being recovered.
      }
    }
  } finally {
    cropper.dispose();
  }
};

export const loadDocumentWithPassword = async (
  pdfBytes: Uint8Array,
  session: PdfLoadSession,
  initialPassword?: string | null,
  signal?: AbortSignal,
): Promise<{ pdfDoc: PDFDocument; openPassword?: string }> => {
  let password: string | undefined =
    typeof initialPassword === "string" ? initialPassword : "";
  let hasPromptedPassword = typeof initialPassword === "string";

  while (true) {
    try {
      const pdfDoc = await loadEditingDocument(pdfBytes, {
        password,
        signal,
      });
      return { pdfDoc, openPassword: password || undefined };
    } catch (error) {
      const reason = getPdfPasswordReason(error, hasPromptedPassword);
      if (!reason) throw error;
      password = await session.requestPassword(reason);
      hasPromptedPassword = true;
    }
  }
};

export const throwIfPdfLoadAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new DOMException("PDF loading aborted", "AbortError");
  }
};

export const yieldPdfHydrationWork = async () => {
  const scheduler = (
    globalThis as typeof globalThis & {
      scheduler?: { yield?: () => Promise<void> };
    }
  ).scheduler;
  if (typeof scheduler?.yield === "function") {
    await scheduler.yield();
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

export const loadPDFInternal = async (
  input: File | Uint8Array,
  options?: LoadPDFInternalOptions,
): Promise<LoadedPdfDocument> => {
  throwIfPdfLoadAborted(options?.signal);
  let pdfBytes: Uint8Array;
  if (input instanceof Uint8Array) {
    pdfBytes = input;
  } else {
    pdfBytes = new Uint8Array(await input.arrayBuffer());
  }
  throwIfPdfLoadAborted(options?.signal);

  let fontMap = new Map<string, string>();
  let globalDA: string | undefined = undefined;
  let systemFontFamilies: string[] | undefined = undefined;
  let systemFontAliasToFamilyCompact: Record<string, string> | undefined =
    undefined;

  const loadSession = createPdfLoadSession("loadPDF", options?.signal);
  let loadOk = false;
  let openPassword: string | undefined = undefined;
  let pdfDoc: PDFDocument | undefined;
  const workerService = options?.workerService;
  if (!workerService)
    throw new Error("PDF pipeline requires its document worker service.");
  const initialPassword =
    typeof options?.password === "string" ? options.password : undefined;
  try {
    const renderBuffer = pdfBytes;

    loadSession.markProgress(0, pdfBytes.length);

    const loadWorker = async (password?: string) => {
      try {
        return await workerService.loadDocument(renderBuffer, {
          password,
          signal: options?.signal,
          onProgress: (payload) => {
            const total =
              typeof payload.total === "number" && payload.total > 0
                ? payload.total
                : pdfBytes.length;
            loadSession.markProgress(payload.loaded, total);
          },
        });
      } catch (e) {
        console.warn("Failed to load PDF into render worker", e);
        return false;
      }
    };

    const loaded = options?.editingDocument
      ? { pdfDoc: options.editingDocument, openPassword: initialPassword }
      : await loadDocumentWithPassword(
          pdfBytes,
          loadSession,
          initialPassword,
          options?.signal,
        );
    const workerReadyInitial = options?.editingDocument
      ? true
      : await loadWorker(loaded.openPassword);
    pdfDoc = loaded.pdfDoc;
    openPassword = loaded.openPassword;
    throwIfPdfLoadAborted(options?.signal);

    try {
      fontMap = getFontMap(pdfDoc);
      globalDA = getGlobalDA(pdfDoc);
    } catch (e) {
      console.warn("Failed to parse PDF resources from the editing graph", e);
    }

    let workerReady = workerReadyInitial;
    if (
      !workerReady &&
      typeof openPassword === "string" &&
      openPassword !== initialPassword
    ) {
      loadSession.markProgress(0, pdfBytes.length);
      workerReady = await loadWorker(openPassword);
    }

    const pdfLibPages = pdfDoc.getPages();
    const numPages = pdfLibPages.length;
    const pages: PageData[] = pdfLibPages.map((pdfLibPage, idx) => {
      const viewport = createPdfLibViewport(pdfLibPage, { scale: 1.0 });
      const userUnit = viewport.userUnit ?? 1;
      return {
        pageIndex: idx,
        width: viewport.width,
        height: viewport.height,
        viewBox:
          viewport.viewBox ??
          ([0, 0, viewport.width / userUnit, viewport.height / userUnit] as [
            number,
            number,
            number,
            number,
          ]),
        userUnit,
        rotation: viewport.rotation,
      };
    });
    const fields: FormField[] = [];
    const annotations: Annotation[] = [];
    const preservedSourceAnnotations: PreservedSourceAnnotationRef[] = [];

    const embeddedFontCache = new Map<string, Promise<string | undefined>>();
    const embeddedFontFaces = new Set<FontFace>();

    const dispose = () => {
      embeddedFontCache.clear();

      if (typeof document !== "undefined" && document.fonts) {
        embeddedFontFaces.forEach((face) => {
          try {
            document.fonts.delete(face);
          } catch {
            // Ignore removal errors
          }
        });
      }
      embeddedFontFaces.clear();
    };

    const toLocalISO = (d: Date) => {
      const pad = (n: number) => n.toString().padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const readMetadataFromPdfLib = (doc: PDFDocument): PDFMetadata => {
      const keywords = doc.getKeywords();
      let keywordsOut: string[] | undefined = undefined;
      if (typeof keywords === "string") {
        keywordsOut = [keywords];
      }
      if (keywordsOut) {
        keywordsOut = keywordsOut.filter(
          (k) => typeof k === "string" && k.trim().length > 0,
        );
        if (keywordsOut.length === 0) keywordsOut = undefined;
      }

      const created = doc.getCreationDate();
      const modified = doc.getModificationDate();

      return {
        title: doc.getTitle(),
        author: doc.getAuthor(),
        subject: doc.getSubject(),
        keywords: keywordsOut,
        creator: doc.getCreator(),
        producer: doc.getProducer(),
        creationDate: created ? toLocalISO(created) : undefined,
        modificationDate: modified ? toLocalISO(modified) : undefined,
        isModDateManual: false,
        isProducerManual: false,
      };
    };

    const metadataPromise = (async (): Promise<PDFMetadata> => {
      if (pdfDoc) {
        try {
          return readMetadataFromPdfLib(pdfDoc);
        } catch (e) {
          console.warn("Failed to extract metadata from the editing graph", e);
        }
      }
      return {};
    })();

    const metadataBase = await metadataPromise;
    options?.onReadable?.({
      pdfBytes,
      pages,
      fields: [],
      annotations: [],
      preservedSourceAnnotations: [],
      metadata: metadataBase,
      documentPermissions: null,
      outline: [],
      openPassword,
      dispose,
    });

    if (options?.waitForHydrationStart) {
      await options.waitForHydrationStart();
    }
    throwIfPdfLoadAborted(options?.signal);

    try {
      const { families, aliases } =
        options?.fontCatalog ?? (await getSystemFontCatalog());
      if (families.length > 0) systemFontFamilies = families;
      if (Object.keys(aliases).length > 0) {
        systemFontAliasToFamilyCompact = aliases;
      }
    } catch (error) {
      console.warn("Failed to load the system font catalog", error);
    }

    const readStreamText = createPdfStreamTextReader();
    let pdfLibAnnotsByPageIndex: Map<number, PdfJsAnnotation[]> | undefined =
      undefined;
    try {
      const resolveDestWithWorker = async (
        normalizedDest: unknown,
      ): Promise<number | null> => {
        if (!workerReady) return null;
        try {
          return await workerService.resolveDest({
            dest: normalizedDest,
            signal: options?.signal,
          });
        } catch {
          return null;
        }
      };

      pdfLibAnnotsByPageIndex = await buildPdfLibAnnotsByPageIndex(pdfDoc, {
        resolveDest: resolveDestWithWorker,
        readStreamText,
        pageIndexes: options?.pageIndexes
          ? new Set(options.pageIndexes)
          : undefined,
        signal: options?.signal,
      });
    } catch (e) {
      console.warn("Failed to extract annotations from the editing graph", e);
    }
    throwIfPdfLoadAborted(options?.signal);

    const permissionsPromise = (async (): Promise<PDFDocumentPermissions> => {
      if (workerReady) {
        try {
          return (
            (await workerService.getPermissions({ signal: options?.signal })) ??
            UNRESTRICTED_PDF_PERMISSIONS
          );
        } catch (e) {
          console.warn("Failed to extract PDF permissions via worker", e);
        }
      }
      return UNRESTRICTED_PDF_PERMISSIONS;
    })();

    const outlinePromise = (async (): Promise<PDFOutlineItem[]> => {
      if (workerReady) {
        try {
          const outline = await workerService.getOutline({
            signal: options?.signal,
          });
          if (outline) return outline;
        } catch (e) {
          console.warn("Failed to extract outline via worker", e);
        }
      }
      return [];
    })();

    const pageResults: {
      page: PageData;
      fields: FormField[];
      annotations: Annotation[];
      preservedSourceAnnotations: PreservedSourceAnnotationRef[];
    }[] = new Array(numPages);

    const maxConcurrency = Math.min(options?.onReadable ? 2 : 4, numPages);
    let nextPageIndex = 0;
    let lastPageYield = performance.now();
    const selectedPages = options?.pageIndexes
      ? new Set(options.pageIndexes)
      : undefined;

    const worker = async () => {
      while (true) {
        const idx = nextPageIndex;
        nextPageIndex += 1;
        if (idx >= numPages) return;

        if (selectedPages && !selectedPages.has(idx)) continue;
        if (performance.now() - lastPageYield > 8) {
          lastPageYield = performance.now();
          await yieldPdfHydrationWork();
        }
        throwIfPdfLoadAborted(options?.signal);
        const pdfLibPage = pdfLibPages[idx];
        if (!pdfLibPage) continue;
        const pageNumber = idx + 1;

        const viewport: ViewportLike = createPdfLibViewport(pdfLibPage, {
          scale: 1.0,
        });
        const pageAnnotations = pdfLibAnnotsByPageIndex?.get(idx) || [];
        const preservedSourceAnnotationsForPage: PreservedSourceAnnotationRef[] =
          [];

        try {
          await populateRenderedStampFallbacksForPage({
            pageAnnotations,
            pageIndex: idx,
            viewport,
            workerService,
            pdfDoc: pdfDoc!,
            signal: options?.signal,
          });
        } catch {
          // ignore stamp preview fallback failures
        }

        const context: ParserContext = {
          pageAnnotations,
          pageIndex: idx,
          viewport,
          preservedSourceAnnotations: preservedSourceAnnotationsForPage,
          pdfDoc,
          fontMap,
          globalDA,
          systemFontFamilies,
          systemFontAliasToFamilyCompact,
          embeddedFontCache,
          collectFont: options?.collectFont,
          embeddedFontFaces,
          readStreamText,
        };

        const annotsForPage: Annotation[] = [];
        for (const parser of annotationParsers) {
          try {
            const parsedAnnots = await parser.parse(context);
            annotsForPage.push(...parsedAnnots);
          } catch (e) {
            console.warn(`Annotation parser failed for page ${pageNumber}`, e);
          }
        }
        attachAnnotationReplies(
          annotsForPage,
          pageAnnotations,
          preservedSourceAnnotationsForPage,
          idx,
        );

        const fieldsForPage: FormField[] = [];
        for (const parser of controlParsers) {
          try {
            const parsedFields = await parser.parse(context);
            fieldsForPage.push(...parsedFields);
          } catch (e) {
            console.warn(`Control parser failed for page ${pageNumber}`, e);
          }
        }

        applyImportedControlLayerOrders(
          pdfLibPage,
          fieldsForPage,
          annotsForPage,
        );

        pageResults[idx] = {
          page: pages[idx]!,
          fields: fieldsForPage,
          annotations: annotsForPage,
          preservedSourceAnnotations: preservedSourceAnnotationsForPage,
        };
      }
    };

    await Promise.all(new Array(maxConcurrency).fill(null).map(() => worker()));

    for (let i = 0; i < pageResults.length; i++) {
      const r = pageResults[i];
      if (!r) continue;
      fields.push(...r.fields);
      annotations.push(...r.annotations);
      preservedSourceAnnotations.push(...r.preservedSourceAnnotations);
    }

    pdfDebug("import:annotations", "annotations_final", () => {
      const counts: Record<string, number> = {};
      for (const a of annotations) {
        const key = a.type || "unknown";
        counts[key] = (counts[key] || 0) + 1;
      }
      const linkWithDest = annotations.filter(
        (a) => a.type === "link" && typeof a.linkDestPageIndex === "number",
      ).length;
      return {
        total: annotations.length,
        counts,
        linkWithDest,
      };
    });

    const [outline, documentPermissions] = await Promise.all([
      outlinePromise,
      permissionsPromise,
    ]);
    throwIfPdfLoadAborted(options?.signal);
    const metadata = {
      ...metadataBase,
      documentPermissions,
    };

    const result = {
      pdfBytes,
      pages,
      fields,
      annotations,
      preservedSourceAnnotations,
      metadata,
      documentPermissions,
      outline,
      openPassword,
      dispose,
    };
    loadOk = true;
    return result;
  } finally {
    if (pdfDoc && !options?.editingDocument) disposeEditingDocument(pdfDoc);
    loadSession.finish(loadOk);
  }
};
