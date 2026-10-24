import type { EditorState } from "@/types";
import { assertPdfPermissionOperation } from "@/lib/pdfPermissions";
import { getPageId, identifyPage } from "./lib/pageStructure";
import { exportPDFBlob } from "./index";

/** Capture the current selection before starting any async PDF work. */
export function exportSelectedPages(state: EditorState, signal?: AbortSignal) {
  if (!state.pdfBytes || state.documentLoadState !== "ready")
    throw new Error("Document is not ready");
  assertPdfPermissionOperation("copy_text", state.documentPermissions);
  const selected = new Set(state.selectedPageIds);
  const pages = state.pages.filter((page) => selected.has(getPageId(page)));
  if (!pages.length) throw new Error("No pages selected");
  const indexes = new Map(pages.map((page, index) => [page.pageIndex, index]));
  const remap = <T extends { pageIndex: number }>(items: T[]) =>
    items.flatMap((item) => {
      const pageIndex = indexes.get(item.pageIndex);
      return pageIndex === undefined ? [] : [{ ...item, pageIndex }];
    });
  const sources = new Set(pages.map((page) => page.source?.documentId));
  return exportPDFBlob(
    state.pdfBytes,
    remap(state.fields),
    state.metadata,
    remap(state.annotations).map((annotation) => ({
      ...annotation,
      linkDestPageIndex:
        annotation.linkDestPageIndex === undefined
          ? undefined
          : indexes.get(annotation.linkDestPageIndex),
    })),
    undefined,
    {
      signal,
      openPassword: state.pdfOpenPassword,
      // Reuse page assembly so forms, native annotations, links and rotations
      // follow the same rules as page deletion/duplication and normal saving.
      pageStructure: {
        pages: pages.map((page, pageIndex) => ({
          ...identifyPage(page),
          pageIndex,
        })),
        sources: Object.fromEntries(
          Object.entries(state.pageSources).filter(([id]) => sources.has(id)),
        ),
      },
      preservedSourceAnnotations: remap(state.preservedSourceAnnotations),
      syncFormFields: true,
      incremental: false,
      // A permitted copy is an independent, unencrypted import source.
      preserveOwnerRestrictions: false,
      removeTextUnderFlattenedFreetext:
        state.options.removeTextUnderFlattenedFreetext,
      imageCompression: state.options.imageCompression,
    },
  );
}
