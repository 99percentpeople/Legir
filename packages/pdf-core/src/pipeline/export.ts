import { FieldType } from "@legir/pdf-model";
import { planFieldTypeReplacements } from "../lib/form-field-types.js";
import {
  loadEditingDocument,
  saveEditingDocument,
  disposeEditingDocument,
} from "../engine/editingDocument.js";
import { prepareExportFonts } from "../lib/export-fonts.js";
import { hexToPdfColor } from "../lib/colors.js";
import {
  captureAcroFormXfaEntry,
  fieldMatchesSourcePdfRef,
  removeMissingOrphanSourcePdfFieldWidgets,
  removeMissingSourcePdfFieldWidgets,
  restoreAcroFormXfaEntry,
  safeRemovePdfField,
  sourcePdfRefToFormKey,
  updateExistingSourceField,
} from "../lib/form-field-export.js";
import { createFormExportContext } from "../lib/form-export-context.js";
import { finalizeFormAppearances } from "../lib/form-appearances.js";
import { prepareAnnotationsForPrint } from "../lib/print-export.js";
import { applyTextRedactionsUnderFlattenedFreetext } from "../lib/textRedaction.js";
import { reconcileAnnotationPopups } from "../lib/annotationReplies.js";
import { applyPdfAnnotationCommentMetadata } from "../lib/annotationCommentMeta.js";
import {
  PDFDocument,
  StandardFonts,
  type PDFFont,
  PDFRef,
  PDFName,
  PDFString,
  PDFDict,
  PDFArray,
  PDFTextField,
  PDFButton,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFPage,
} from "@legir/pdfium/authoring";
import {
  getEffectivePdfPermissions,
  getPdfPermissionPolicy,
} from "@legir/pdf-model/pdfPermissions";
import {
  FormField,
  PDFDocumentPermissions,
  PDFMetadata,
  Annotation,
  AnnotationReply,
  PreservedSourceAnnotationRef,
  ImageCompressionOptions,
} from "@legir/pdf-model";
import {
  canPreserveSourceAnnotation,
  getOrderedExportControlsByPage,
  reorderExportedPageAnnotations,
} from "../lib/annotation-layer-order.js";
import { ViewportLike } from "../types.js";
import { annotationExporters, controlExporters } from "../exporters/index.js";
import { createPdfLibViewport, uiRectToPdfBounds } from "../lib/coords.js";
import { yieldPdfHydrationWork } from "./load.js";

export const sourcePdfRefToKey = (
  ref: { objectNumber: number; generationNumber: number } | undefined | null,
) => {
  if (!ref) return null;
  return ref.generationNumber === 0
    ? `${ref.objectNumber}R`
    : `${ref.objectNumber}R${ref.generationNumber}`;
};

export const pdfRefToKey = (ref: PDFRef | undefined | null) => {
  if (!ref) return null;
  return sourcePdfRefToKey({
    objectNumber: ref.objectNumber,
    generationNumber: ref.generationNumber,
  });
};

export const exportAnnotationReply = (options: {
  pdfDoc: PDFDocument;
  page: PDFPage;
  parentAnnotation: Annotation;
  parentRef: PDFRef;
  reply: AnnotationReply;
  viewport?: ViewportLike;
}) => {
  const { pdfDoc, page, parentAnnotation, parentRef, reply, viewport } =
    options;
  // Keep the source dictionary for edits: review state, flags, appearances and
  // popup references are not all represented in the editor model.
  if (reply.sourcePdfRef) {
    const ref = PDFRef.of(
      reply.sourcePdfRef.objectNumber,
      reply.sourcePdfRef.generationNumber,
    );
    const existing = pdfDoc.context.lookup(ref);
    if (existing instanceof PDFDict) {
      if (reply.isEdited) {
        applyPdfAnnotationCommentMetadata(existing, reply);
        existing.delete(PDFName.of("RC"));
      }
      return ref;
    }
  }
  const baseRect =
    parentAnnotation.rect ??
    (parentAnnotation.rects && parentAnnotation.rects.length > 0
      ? parentAnnotation.rects[0]
      : null);

  const bounds = baseRect
    ? uiRectToPdfBounds(page, baseRect, viewport)
    : {
        x: 12,
        y: 12,
        width: 24,
        height: 24,
      };

  const colorObj = parentAnnotation.color
    ? hexToPdfColor(parentAnnotation.color)
    : undefined;
  const color =
    colorObj &&
    typeof colorObj.red === "number" &&
    typeof colorObj.green === "number" &&
    typeof colorObj.blue === "number"
      ? [colorObj.red, colorObj.green, colorObj.blue]
      : undefined;

  const replyAnnot = pdfDoc.context.obj({
    Type: "Annot",
    Subtype: "Text",
    F: 4,
    Rect: [
      bounds.x,
      bounds.y,
      bounds.x + Math.max(24, bounds.width),
      bounds.y + Math.max(24, bounds.height),
    ],
    C: color,
    Name: PDFName.of("Comment"),
    P: page.ref,
    IRT: parentRef,
    RT: PDFName.of("R"),
  });
  if (replyAnnot instanceof PDFDict) {
    applyPdfAnnotationCommentMetadata(replyAnnot, reply);
  }

  const ref = pdfDoc.context.register(replyAnnot);
  page.node.addAnnot(ref);
  return ref;
};

export const toPdfPermissionBits = (permissions: PDFDocumentPermissions) =>
  (permissions.canPrint ? 4 : 0) |
  (permissions.canModifyContents ? 8 : 0) |
  (permissions.canCopy ? 16 : 0) |
  (permissions.canModifyAnnotations ? 32 : 0) |
  (permissions.canFillForms ? 256 : 0) |
  (permissions.canCopyForAccessibility ? 512 : 0) |
  (permissions.canAssemble ? 1024 : 0) |
  (permissions.canPrintHighQuality ? 2048 : 0);

export const exportPDF = async (
  originalBytes: Uint8Array,
  fields: FormField[],
  metadata?: PDFMetadata,
  annotations: Annotation[] = [],
  customFont?: { bytes?: Uint8Array; name?: string },
  options?: {
    editingDocument?: PDFDocument;
    signal?: AbortSignal;
    writeChunk?: (bytes: Uint8Array) => void | Promise<void>;
    writeBlob?: (chunk: Blob) => void;
    onSaveMode?: (incremental: boolean) => void;
    /** Disable append saving when compact output or history removal is needed. */
    incremental?: boolean;
    onSavedDocument?: (document: PDFDocument) => Promise<void>;
    /** Include a cover only when the caller will persist a recent-file entry. */
    includePreview?: boolean;
    permissionPolicy?: { ignorePdfPermissions: boolean };
    resolveSource?: (id: string) => Promise<PDFDocument>;
    openPassword?: string | null;
    exportPassword?: string | null;
    removeTextUnderFlattenedFreetext?: boolean;
    imageCompression?: ImageCompressionOptions;
    pageIndexes?: number[];
    pageStructure?: {
      pages: import("@legir/pdf-model").PageData[];
      sources: Record<string, import("@legir/pdf-model").PageSource>;
    };
    preservedSourceAnnotations?: PreservedSourceAnnotationRef[];
    flattenFormFields?: boolean;
    syncFormFields?: boolean;
    sourceDocumentPermissions?: PDFDocumentPermissions | null;
    preserveOwnerRestrictions?: boolean;
    ownerPassword?: string | null;
  },
): Promise<Uint8Array> => {
  if (originalBytes.byteLength === 0) throw new Error("PDF buffer is empty.");

  options?.signal?.throwIfAborted();
  let lastYield = performance.now();
  const checkpoint = async () => {
    if (performance.now() - lastYield > 8) {
      await yieldPdfHydrationWork();
      lastYield = performance.now();
    }
    options?.signal?.throwIfAborted();
  };
  const openPassword =
    typeof options?.openPassword === "string" && options.openPassword
      ? options.openPassword
      : undefined;

  const exportPassword =
    typeof options?.exportPassword === "string" && options.exportPassword
      ? options.exportPassword
      : undefined;

  const removeTextUnderFlattenedFreetext =
    typeof options?.removeTextUnderFlattenedFreetext === "boolean"
      ? options.removeTextUnderFlattenedFreetext
      : true;

  const resolvedOpenPassword = openPassword ?? undefined;

  const pdfDoc =
    options?.editingDocument ??
    (await loadEditingDocument(originalBytes, {
      password: resolvedOpenPassword ?? "",
    }));

  try {
    const structure = options?.pageStructure;
    const keepsOriginalPages =
      !structure ||
      (structure.pages.length === pdfDoc.getPageCount() &&
        structure.pages.every(
          (page, index) =>
            !page.blank &&
            !page.source?.copyGroup &&
            (page.source?.documentId ?? "default") === "default" &&
            (page.source?.pageIndex ?? page.pageIndex) === index,
        ));
    const incremental =
      options?.incremental !== false &&
      !!options?.onSaveMode &&
      !options?.flattenFormFields &&
      !options?.pageIndexes &&
      keepsOriginalPages;
    let applyPageRotation: (() => void) | undefined;
    if (
      structure &&
      // The UI always supplies page IDs. An unchanged order needs no page-tree,
      // form-tree or destination rebuild; rotations still use the assembly path.
      (!keepsOriginalPages ||
        structure.pages.some((page) => page.rotationDelta)) &&
      structure.pages.some(
        (page) => page.id || page.blank || page.rotationDelta,
      )
    ) {
      const { assemblePages } = await import("../lib/assemblePages.js");
      const assembled = await assemblePages(
        pdfDoc,
        originalBytes,
        resolvedOpenPassword,
        structure,
        {
          fields,
          annotations,
          preserved: options?.preservedSourceAnnotations ?? [],
        },
        options?.resolveSource,
        options?.signal,
      );
      fields = assembled.fields;
      annotations = assembled.annotations;
      options = { ...options, preservedSourceAnnotations: assembled.preserved };
      applyPageRotation = assembled.applyRotation;
    }

    const pdfLibPages = pdfDoc.getPages();
    const targetPageIndexes = Array.isArray(options?.pageIndexes)
      ? Array.from(
          new Set(
            options.pageIndexes
              .map((pageIndex) => Math.trunc(pageIndex))
              .filter(
                (pageIndex) =>
                  Number.isFinite(pageIndex) &&
                  pageIndex >= 0 &&
                  pageIndex < pdfLibPages.length,
              ),
          ),
        ).sort((left, right) => left - right)
      : [];
    const targetPageIndexSet =
      targetPageIndexes.length > 0 ? new Set(targetPageIndexes) : null;
    const viewportCache = new Map<number, ViewportLike>();
    const getViewportForPage = async (pageIndex: number) => {
      const cached = viewportCache.get(pageIndex);
      if (cached) return cached;
      const page = pdfLibPages[pageIndex];
      if (!page) return undefined;
      const vp = createPdfLibViewport(page, { scale: 1.0 });
      viewportCache.set(pageIndex, vp);
      return vp;
    };

    const sourcePermissions =
      options?.sourceDocumentPermissions ??
      metadata?.documentPermissions ??
      null;
    const preserveOwnerRestrictions =
      options?.preserveOwnerRestrictions !== false;
    const permissionPolicy =
      options?.permissionPolicy ?? getPdfPermissionPolicy();
    const canUpdateDocumentMetadata =
      permissionPolicy.ignorePdfPermissions ||
      getEffectivePdfPermissions(
        metadata?.documentPermissions ?? sourcePermissions,
      ).canModifyContents;

    // Metadata update
    if (metadata && canUpdateDocumentMetadata) {
      if (metadata.title !== undefined) pdfDoc.setTitle(metadata.title);
      if (metadata.author !== undefined) pdfDoc.setAuthor(metadata.author);
      if (metadata.subject !== undefined) pdfDoc.setSubject(metadata.subject);
      if (metadata.creator !== undefined) pdfDoc.setCreator(metadata.creator);
      if (metadata.keywords !== undefined) {
        pdfDoc.setKeywords(
          Array.isArray(metadata.keywords)
            ? metadata.keywords
            : [metadata.keywords],
        );
      }

      // Producer Logic
      if (metadata.isProducerManual && metadata.producer !== undefined) {
        pdfDoc.setProducer(metadata.producer);
      } else {
        pdfDoc.setProducer("Legir");
      }

      // Date Logic with explicit PDFString.fromDate formatting
      const infoDict = pdfDoc.catalog.lookup(PDFName.of("Info"));
      if (infoDict instanceof PDFDict) {
        if (metadata.creationDate) {
          infoDict.set(
            PDFName.of("CreationDate"),
            PDFString.fromDate(new Date(metadata.creationDate)),
          );
        }

        // Modification Date Logic
        let modDate: Date;
        if (
          metadata.isModDateManual &&
          metadata.modificationDate !== undefined
        ) {
          modDate = new Date(metadata.modificationDate);
        } else {
          modDate = new Date();
        }

        infoDict.set(PDFName.of("ModDate"), PDFString.fromDate(modDate));
      }
    }

    const fontMap = new Map<string, PDFFont>();
    // Metadata/preserved-content saves need no new appearance resources. Apart
    // from needless serialization, allocating fonts invalidates native pages.
    const needsAppearances =
      fields.length > 0 ||
      annotations.some(
        (annotation) => !canPreserveSourceAnnotation(annotation),
      );
    if (needsAppearances) {
      fontMap.set("Helvetica", await pdfDoc.embedFont(StandardFonts.Helvetica));
      fontMap.set(
        "Times Roman",
        await pdfDoc.embedFont(StandardFonts.TimesRoman),
      );
      fontMap.set("Courier", await pdfDoc.embedFont(StandardFonts.Courier));
    }

    const xfaEntry = captureAcroFormXfaEntry(pdfDoc);
    const form =
      fields.length > 0 || pdfDoc.catalog.has(PDFName.of("AcroForm"))
        ? pdfDoc.getForm()
        : undefined;
    restoreAcroFormXfaEntry(xfaEntry);

    const orderedControlsByPage = getOrderedExportControlsByPage(
      fields,
      annotations,
    );

    if (needsAppearances)
      await prepareExportFonts({
        pdfDoc,
        fontMap,
        fields: fields.filter(
          (field) =>
            field.pageIndex >= 0 &&
            field.pageIndex < pdfLibPages.length &&
            (!targetPageIndexSet || targetPageIndexSet.has(field.pageIndex)),
        ),
        annotations: annotations.filter(
          (annotation) =>
            annotation.pageIndex >= 0 &&
            annotation.pageIndex < pdfLibPages.length &&
            (!targetPageIndexSet ||
              targetPageIndexSet.has(annotation.pageIndex)) &&
            !canPreserveSourceAnnotation(annotation),
        ),
        customFont,
      });

    const keepAnnotRefKeysByPage = new Map<number, Set<string>>();
    for (const a of annotations) {
      if (a.type === "freetext" && a.flatten) continue;
      const setForPage =
        keepAnnotRefKeysByPage.get(a.pageIndex) || new Set<string>();
      if (a.sourcePdfRef && canPreserveSourceAnnotation(a))
        setForPage.add(
          `${a.sourcePdfRef.objectNumber}:${a.sourcePdfRef.generationNumber}`,
        );

      for (const reply of a.replies ?? []) {
        if (!reply.sourcePdfRef) continue;
        setForPage.add(
          `${reply.sourcePdfRef.objectNumber}:${reply.sourcePdfRef.generationNumber}`,
        );
      }

      keepAnnotRefKeysByPage.set(a.pageIndex, setForPage);
    }

    for (const preserved of options?.preservedSourceAnnotations || []) {
      if (!preserved?.sourcePdfRef) continue;
      if (targetPageIndexSet && !targetPageIndexSet.has(preserved.pageIndex)) {
        continue;
      }
      const key = `${preserved.sourcePdfRef.objectNumber}:${preserved.sourcePdfRef.generationNumber}`;
      const setForPage =
        keepAnnotRefKeysByPage.get(preserved.pageIndex) || new Set<string>();
      setForPage.add(key);
      keepAnnotRefKeysByPage.set(preserved.pageIndex, setForPage);
    }

    // 1. Cleanup Existing Fields
    const sourceFieldRefKeys = new Set(
      fields
        .map((field) => sourcePdfRefToFormKey(field.sourcePdfRef))
        .filter((key): key is string => !!key),
    );
    const shouldSyncFormFields = options?.syncFormFields ?? fields.length > 0;
    const currentFieldNamesWithoutSourceRefs = new Set(
      fields.filter((field) => !field.sourcePdfRef).map((field) => field.name),
    );
    if (shouldSyncFormFields) {
      // A PDF can have page widgets without a catalog AcroForm. Deleting the
      // last orphan still needs the page scan, without creating an empty form.
      removeMissingOrphanSourcePdfFieldWidgets(
        form ?? { doc: pdfDoc, getFields: () => [] },
        sourceFieldRefKeys,
      );
    }
    const existingFields = form?.getFields() ?? [];
    const replacements =
      form && shouldSyncFormFields
        ? planFieldTypeReplacements(form, fields, existingFields)
        : new Set();
    const originalFieldNames = new Set(
      existingFields
        .filter((field) => !replacements.has(field.ref))
        .map((field) => field.getName()),
    );
    for (const field of existingFields) {
      await checkpoint();
      if (!form) break;
      if (replacements.has(field.ref)) {
        safeRemovePdfField(form, field);
        continue;
      }
      let shouldRemove = false;
      try {
        const typeName = field.constructor.name;
        const isText =
          field instanceof PDFTextField || typeName === "PDFTextField";
        const isCheck =
          field instanceof PDFCheckBox || typeName === "PDFCheckBox";
        const isDropdown =
          field instanceof PDFDropdown || typeName === "PDFDropdown";
        const isOptionList =
          field instanceof PDFOptionList || typeName === "PDFOptionList";
        const isRadio =
          field instanceof PDFRadioGroup || typeName === "PDFRadioGroup";
        const isSig =
          (typeof PDFSignature !== "undefined" &&
            field instanceof PDFSignature) ||
          typeName === "PDFSignature";
        const isButton = field instanceof PDFButton || typeName === "PDFButton";
        const isSupportedExportField =
          isText ||
          isCheck ||
          isDropdown ||
          isOptionList ||
          isRadio ||
          isSig ||
          isButton;
        const isImportedSourceField = fieldMatchesSourcePdfRef(
          field,
          sourceFieldRefKeys,
        );
        const isCurrentFieldByName = currentFieldNamesWithoutSourceRefs.has(
          field.getName(),
        );

        if (
          shouldSyncFormFields &&
          isSupportedExportField &&
          isImportedSourceField
        ) {
          removeMissingSourcePdfFieldWidgets(form, field, sourceFieldRefKeys);
        }

        shouldRemove =
          shouldSyncFormFields &&
          isSupportedExportField &&
          !isCurrentFieldByName &&
          !isImportedSourceField;

        if (shouldRemove) {
          safeRemovePdfField(form, field);
        }
      } catch {
        console.warn(
          `Attempting manual removal for corrupt field: ${field.getName()}`,
        );

        if (shouldRemove) {
          safeRemovePdfField(form, field);
        }
      }
    }

    // 1.5 Cleanup Existing Annotations (Ink, Highlight, Comment)
    const removedAnnotationRefs = new Map<number, Set<string>>();
    const replacementAnnotationRefs = new Map<string, PDFRef>();
    const pages = pdfDoc.getPages();
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      await checkpoint();
      if (targetPageIndexSet && !targetPageIndexSet.has(pageIndex)) continue;
      const page = pages[pageIndex];
      try {
        const annots = page.node.Annots();
        if (annots instanceof PDFArray) {
          const toRemove: number[] = [];

          const keepKeys = keepAnnotRefKeysByPage.get(pageIndex);

          for (let i = 0; i < annots.size(); i++) {
            if (keepKeys) {
              const raw = annots.get(i);
              if (raw instanceof PDFRef) {
                const k = `${raw.objectNumber}:${raw.generationNumber}`;
                if (keepKeys.has(k)) continue;
              }
            }

            const annot = annots.lookup(i);
            if (annot instanceof PDFDict) {
              const subtype = annot.lookup(PDFName.of("Subtype"));
              if (
                subtype === PDFName.of("Ink") ||
                subtype === PDFName.of("Highlight") ||
                subtype === PDFName.of("Text") ||
                subtype === PDFName.of("FreeText") ||
                subtype === PDFName.of("Stamp") ||
                subtype === PDFName.of("Link") ||
                subtype === PDFName.of("Square") ||
                subtype === PDFName.of("Circle") ||
                subtype === PDFName.of("Line") ||
                subtype === PDFName.of("PolyLine") ||
                subtype === PDFName.of("Polygon")
              ) {
                toRemove.push(i);
                const raw = annots.get(i);
                if (raw instanceof PDFRef) {
                  const removed =
                    removedAnnotationRefs.get(pageIndex) ?? new Set<string>();
                  removed.add(raw.toString());
                  removedAnnotationRefs.set(pageIndex, removed);
                }
              }
            }
          }

          toRemove
            .sort((a, b) => b - a)
            .forEach((idx) => {
              annots.remove(idx);
            });
        }
      } catch (e) {
        console.warn("Failed to cleanup annotations on page", e);
      }
    }

    if (removeTextUnderFlattenedFreetext) {
      await applyTextRedactionsUnderFlattenedFreetext({
        pdfDoc,
        pages,
        annotations,
        getViewportForPage,
        targetPageIndexSet,
      });
    }

    // 2. Export Controls In Layer Order
    const formExportContext =
      fields.length > 0 && form ? createFormExportContext(form) : undefined;
    const exportedAnnotationRefById = new Map<string, PDFRef>();
    for (const annotation of annotations) {
      await checkpoint();
      if (!annotation.sourcePdfRef || !canPreserveSourceAnnotation(annotation))
        continue;
      exportedAnnotationRefById.set(
        annotation.id,
        PDFRef.of(
          annotation.sourcePdfRef.objectNumber,
          annotation.sourcePdfRef.generationNumber,
        ),
      );
    }

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      await checkpoint();
      if (targetPageIndexSet && !targetPageIndexSet.has(pageIndex)) continue;
      const orderedControls = orderedControlsByPage.get(pageIndex) ?? [];
      if (orderedControls.length === 0) continue;

      const page = pdfDoc.getPage(pageIndex);
      const viewport = await getViewportForPage(pageIndex);

      for (const entry of orderedControls) {
        if (entry.kind === "annotation") {
          const annot = entry.control;
          if (canPreserveSourceAnnotation(annot)) continue;
          const exporter = annotationExporters.find((e) =>
            e.shouldExport(annot),
          );
          if (!exporter) continue;
          try {
            const exportedRef = await exporter.save(
              pdfDoc,
              page,
              annot,
              fontMap,
              viewport,
              { imageCompression: options?.imageCompression },
            );
            if (exportedRef) {
              exportedAnnotationRefById.set(annot.id, exportedRef);
              if (annot.sourcePdfRef) {
                const oldRef = PDFRef.of(
                  annot.sourcePdfRef.objectNumber,
                  annot.sourcePdfRef.generationNumber,
                );
                replacementAnnotationRefs.set(oldRef.toString(), exportedRef);
                const source = pdfDoc.context.lookup(oldRef);
                const target = pdfDoc.context.lookup(exportedRef);
                if (source instanceof PDFDict && target instanceof PDFDict) {
                  for (const key of ["Popup", "F", "State", "StateModel"]) {
                    const name = PDFName.of(key);
                    const value = source.get(name);
                    if (value) target.set(name, value);
                  }
                }
              }
            }
          } catch (e) {
            console.error(`Failed to export annotation ${annot.id}`, e);
          }
          continue;
        }

        const field = entry.control;
        if (!form) throw new Error("Missing export form for a field control.");
        const isNewSpecialWidget =
          (field.type === FieldType.BUTTON ||
            field.type === FieldType.SIGNATURE) &&
          !field.sourcePdfRef &&
          !originalFieldNames.has(field.name);
        const didUpdateExistingField =
          !isNewSpecialWidget &&
          (await updateExistingSourceField(form, field, fontMap, {
            flattenAppearance: options?.flattenFormFields === true,
            viewport,
            context: formExportContext,
          }));
        if (didUpdateExistingField) continue;

        const exporter = controlExporters.find((e) => e.shouldExport(field));
        if (!exporter) continue;
        try {
          await exporter.save(form, field, fontMap, viewport, {
            flattenAppearance: options?.flattenFormFields === true,
            context: formExportContext,
          });
        } catch (e) {
          if (
            field.type === FieldType.BUTTON ||
            field.type === FieldType.SIGNATURE
          )
            throw e;
          console.error(`Failed to export field ${field.name}`, e);
        }
      }
    }

    // Updating a field regenerates every widget it owns. Do this only once per
    // field, after all controls have supplied their final values and geometry.
    formExportContext?.flushAppearanceUpdates();

    for (const annotation of annotations) {
      await checkpoint();
      if (targetPageIndexSet && !targetPageIndexSet.has(annotation.pageIndex)) {
        continue;
      }
      if (!annotation.replies || annotation.replies.length === 0) continue;

      const parentRef = exportedAnnotationRefById.get(annotation.id);
      if (!parentRef) continue;

      const page = pdfDoc.getPage(annotation.pageIndex);
      const viewport = await getViewportForPage(annotation.pageIndex);

      const replyRefs = new Map<string, PDFRef>();
      // Allocate/reuse all objects before linking them; /Annots may list children first.
      for (const reply of annotation.replies) {
        const ref = exportAnnotationReply({
          pdfDoc,
          page,
          parentAnnotation: annotation,
          parentRef,
          reply,
          viewport,
        });
        replyRefs.set(reply.id, ref);
      }
      for (const reply of annotation.replies) {
        const ref = replyRefs.get(reply.id)!;
        const dict = pdfDoc.context.lookup(ref, PDFDict);
        const target =
          (reply.inReplyToReplyId && replyRefs.get(reply.inReplyToReplyId)) ||
          parentRef;
        if (dict.get(PDFName.of("IRT")) !== target)
          dict.set(PDFName.of("IRT"), target);
        if (dict.get(PDFName.of("P")) !== page.ref)
          dict.set(PDFName.of("P"), page.ref);
      }
    }

    for (const [pageIndex, removed] of removedAnnotationRefs) {
      reconcileAnnotationPopups(
        pages[pageIndex],
        replacementAnnotationRefs,
        removed,
      );
    }

    for (const [pageIndex, controls] of orderedControlsByPage) {
      if (targetPageIndexSet && !targetPageIndexSet.has(pageIndex)) continue;
      const page = pages[pageIndex];
      if (!page) continue;
      try {
        reorderExportedPageAnnotations(
          page,
          controls,
          exportedAnnotationRefById,
          formExportContext,
        );
      } catch (error) {
        console.warn("Failed to reorder annotations on page", error);
      }
    }

    restoreAcroFormXfaEntry(xfaEntry);

    if (options?.flattenFormFields && form && form.getFields().length > 0) {
      try {
        form.flatten({ updateFieldAppearances: false });
      } catch (error) {
        console.warn("Failed to flatten form fields", error);
      }
      restoreAcroFormXfaEntry(xfaEntry);
    }

    if (options?.flattenFormFields) {
      try {
        await prepareAnnotationsForPrint({
          pages,
          annotations,
          getViewportForPage,
          targetPageIndexSet,
        });
      } catch (error) {
        console.warn("Failed to prepare annotations for print", error);
      }
    }

    applyPageRotation?.();

    if (targetPageIndexes.length > 0) {
      const indexesToRemove = Array.from(
        { length: pages.length },
        (_, index) => index,
      )
        .filter((pageIndex) => !targetPageIndexSet?.has(pageIndex))
        .sort((left, right) => right - left);

      for (const pageIndex of indexesToRemove) {
        pdfDoc.removePage(pageIndex);
      }
    }

    const hasOwnerPassword = typeof options?.ownerPassword === "string";
    const ownerPassword = hasOwnerPassword ? options?.ownerPassword : undefined;
    const clearsRestrictionsByIgnoringPermissions =
      permissionPolicy.ignorePdfPermissions && !hasOwnerPassword;
    const shouldPreserveSourceRestrictions =
      preserveOwnerRestrictions &&
      !!sourcePermissions?.hasOwnerRestrictions &&
      !clearsRestrictionsByIgnoringPermissions;

    if (shouldPreserveSourceRestrictions && !hasOwnerPassword) {
      throw new Error(
        "Owner password is required to preserve PDF restrictions.",
      );
    }

    const security =
      exportPassword || shouldPreserveSourceRestrictions
        ? {
            userPassword: exportPassword ?? resolvedOpenPassword ?? "",
            ownerPassword: shouldPreserveSourceRestrictions
              ? ownerPassword!
              : exportPassword!,
            ...(shouldPreserveSourceRestrictions
              ? { permissions: toPdfPermissionBits(sourcePermissions!) }
              : {}),
          }
        : undefined;
    restoreAcroFormXfaEntry(xfaEntry);
    await finalizeFormAppearances(pdfDoc, {
      form,
      flatten: options?.flattenFormFields,
      regenerated: formExportContext?.regeneratedAppearances,
      checkpoint,
    });
    options?.signal?.throwIfAborted();
    const output = await saveEditingDocument(pdfDoc, {
      incremental,
      onSaveMode: options?.onSaveMode,
      security,
      signal: options?.signal,
      writeChunk: options?.writeChunk,
      writeBlob: options?.writeBlob,
    });
    await options?.onSavedDocument?.(pdfDoc);
    return output;
  } finally {
    if (!options?.editingDocument) disposeEditingDocument(pdfDoc);
  }
};
