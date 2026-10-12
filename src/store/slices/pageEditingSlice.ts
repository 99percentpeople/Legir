import type {
  Annotation,
  FormField,
  PageData,
  PageSource,
  PreservedSourceAnnotationRef,
} from "@/types";
import type { EditorActions, EditorStoreSlice } from "../store.types";
import {
  assertPdfPermissionOperation,
  mergePdfPermissionDirtyScopes,
} from "@/lib/pdfPermissions";
import {
  getPageId,
  identifyPage,
  identifyPages,
  mapPageIndexes,
  remapOutline,
} from "@/services/pdfService/lib/pageStructure";
import { captureHistorySnapshot } from "./historySlice";
import { cloneAnnotationReplies } from "@/lib/annotationReplies";
import { revokeObjectUrlIfNeeded } from "../helpers";

export type ImportedPages = {
  source: PageSource;
  pages: PageData[];
  fields: FormField[];
  annotations: Annotation[];
  preservedSourceAnnotations: PreservedSourceAnnotationRef[];
  indexes: number[];
};

const newId = () => crypto.randomUUID();

export const createPageEditingSlice: EditorStoreSlice<
  Pick<
    EditorActions,
    | "setSelectedPageIds"
    | "rotatePages"
    | "deletePages"
    | "movePages"
    | "duplicatePages"
    | "addBlankPages"
    | "insertPdfPages"
  >
> = (set, get) => {
  const check = () => {
    const state = get();
    if (!state.pdfBytes || state.documentLoadState !== "ready")
      throw new Error("Document is not ready");
    assertPdfPermissionOperation("assemble_pages", state.documentPermissions);
    return state;
  };
  const commit = (
    nextPages: PageData[],
    extra?: {
      fields?: FormField[];
      annotations?: Annotation[];
      preserved?: PreservedSourceAnnotationRef[];
      sources?: Record<string, PageSource>;
      selection?: string[];
    },
  ) => {
    const state = check();
    if (!nextPages.length) return;
    // Preserve untouched pages and give moved pages a stable source before
    // changing their logical index. Memoized cards can then keep their content.
    const pages = nextPages.map((page, pageIndex) =>
      page.pageIndex === pageIndex
        ? page
        : { ...identifyPage(page), pageIndex },
    );
    const indexes = mapPageIndexes(state.pages, pages);
    const remap = <T extends { pageIndex: number }>(items: T[]) =>
      items.flatMap((item) => {
        const pageIndex = indexes.get(item.pageIndex);
        return pageIndex === undefined
          ? []
          : [pageIndex === item.pageIndex ? item : { ...item, pageIndex }];
      });
    const annotations = remap(state.annotations).map((annotation) => {
      const linkDestPageIndex =
        annotation.linkDestPageIndex === undefined
          ? undefined
          : indexes.get(annotation.linkDestPageIndex);
      return linkDestPageIndex === annotation.linkDestPageIndex
        ? annotation
        : { ...annotation, linkDestPageIndex };
    });
    const images: Record<number, string> = {};
    for (const [before, after] of indexes)
      if (after !== undefined && state.thumbnailImages[before])
        images[after] = state.thumbnailImages[before];
    const previews: Record<number, string> = {};
    for (const [before, after] of indexes)
      if (after !== undefined && state.pagePreviewImages[before])
        previews[after] = state.pagePreviewImages[before];
    const retainedPreviews = new Set(Object.values(previews));
    for (const url of new Set(Object.values(state.pagePreviewImages)))
      if (!retainedPreviews.has(url)) revokeObjectUrlIfNeeded(url);
    const retained = new Set(Object.values(images));
    state.cancelThumbnailWarmup();
    for (const url of new Set(Object.values(state.thumbnailImages)))
      if (!retained.has(url)) revokeObjectUrlIfNeeded(url);
    const pageIds = new Set(pages.map(getPageId));
    const selected =
      extra?.selection ?? state.selectedPageIds.filter((id) => pageIds.has(id));
    const currentPageIndex =
      indexes.get(state.currentPageIndex) ??
      Math.min(state.currentPageIndex, pages.length - 1);
    set({
      pages,
      fields: [...remap(state.fields), ...(extra?.fields ?? [])],
      annotations: [...annotations, ...(extra?.annotations ?? [])],
      preservedSourceAnnotations: [
        ...remap(state.preservedSourceAnnotations),
        ...(extra?.preserved ?? []),
      ],
      pageSources: Object.fromEntries(
        Object.entries(extra?.sources ?? state.pageSources).filter(([id]) =>
          pages.some((page) => page.source?.documentId === id),
        ),
      ),
      outline: remapOutline(state.outline, indexes),
      past: [...state.past, captureHistorySnapshot(state)].slice(-50),
      future: [],
      selectedPageIds: selected.length
        ? selected
        : [getPageId(pages[currentPageIndex])],
      currentPageIndex,
      selectedId: null,
      clipboard: null,
      thumbnailImages: images,
      pagePreviewImages: previews,
      pageTranslateParagraphCandidates: [],
      pageTranslateSelectedParagraphIds: [],
      isDirty: true,
      dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
        state.dirtyPermissionScopes,
        { assemble: true },
      ),
    });
  };
  const insert = (
    payload: Omit<ImportedPages, "source">,
    at: number,
    source?: PageSource,
  ) => {
    const state = check();
    const sourceId = source ? newId() : null;
    const copyGroup = newId();
    const selected = new Set(payload.indexes);
    const donorPages = identifyPages(payload.pages).filter((page) =>
      selected.has(page.pageIndex),
    );
    if (!donorPages.length) return;
    const position = Math.max(0, Math.min(state.pages.length, Math.trunc(at)));
    const indexes = new Map(
      donorPages.map((page, i) => [page.pageIndex, position + i]),
    );
    const pages = donorPages.map((page) => ({
      ...page,
      id: newId(),
      source: page.blank
        ? undefined
        : {
            documentId: sourceId ?? page.source!.documentId,
            pageIndex: sourceId ? page.pageIndex : page.source!.pageIndex,
            copyGroup: sourceId
              ? copyGroup
              : `${copyGroup}:${page.source?.copyGroup ?? "original"}`,
          },
    }));
    const names = new Set(state.fields.map((field) => field.name));
    const renamed = new Map<string, string>();
    const clone = <T extends { pageIndex: number }>(items: T[]) =>
      items.flatMap((item) => {
        const pageIndex = indexes.get(item.pageIndex);
        return pageIndex === undefined
          ? []
          : [{ ...structuredClone(item), pageIndex }];
      });
    const fields = clone(payload.fields).map((field) => {
      let name = renamed.get(field.name);
      if (!name) {
        name = field.name;
        for (let suffix = 2; names.has(name); suffix++)
          name = `${field.name}_${suffix}`;
        names.add(name);
        renamed.set(field.name, name);
      }
      return { ...field, id: newId(), name };
    });
    const annotations = clone(payload.annotations).map((annotation) => {
      const id = newId();
      return {
        ...annotation,
        id,
        linkDestPageIndex:
          annotation.linkDestPageIndex === undefined
            ? undefined
            : (indexes.get(annotation.linkDestPageIndex) ??
              (source
                ? undefined
                : annotation.linkDestPageIndex +
                  (annotation.linkDestPageIndex >= position
                    ? pages.length
                    : 0))),
        replies: cloneAnnotationReplies(annotation.replies, id, newId),
      };
    });
    const next: PageData[] = identifyPages(state.pages);
    next.splice(position, 0, ...pages);
    commit(next, {
      fields,
      annotations,
      preserved: clone(payload.preservedSourceAnnotations),
      selection: pages.map(getPageId),
      sources:
        source && sourceId
          ? { ...state.pageSources, [sourceId]: source }
          : undefined,
    });
  };
  return {
    setSelectedPageIds: (ids) =>
      set((state) => {
        const available = new Set(state.pages.map(getPageId));
        const selectedPageIds = [...new Set(ids)].filter((id) =>
          available.has(id),
        );
        return selectedPageIds.length === state.selectedPageIds.length &&
          selectedPageIds.every(
            (id, index) => id === state.selectedPageIds[index],
          )
          ? state
          : { selectedPageIds };
      }),
    rotatePages: (ids, degrees) => {
      const state = check();
      const selected = new Set(ids);
      if (
        !state.pages.some((page) => selected.has(getPageId(page))) ||
        ![90, -90, 180].includes(degrees)
      )
        return;
      commit(
        identifyPages(state.pages).map((page) =>
          selected.has(getPageId(page))
            ? {
                ...page,
                rotationDelta:
                  ((page.rotationDelta ?? 0) + degrees + 360) % 360,
              }
            : page,
        ),
      );
    },
    deletePages: (ids) => {
      const state = check();
      const selected = new Set(ids);
      const pages = identifyPages(state.pages).filter(
        (page) => !selected.has(getPageId(page)),
      );
      if (!pages.length || pages.length === state.pages.length) return;
      const firstDeleted = state.pages.findIndex((page) =>
        selected.has(getPageId(page)),
      );
      commit(pages, {
        selection: [getPageId(pages[Math.min(firstDeleted, pages.length - 1)])],
      });
    },
    movePages: (ids, beforeIndex) => {
      const state = check();
      const selected = new Set(ids);
      const pages = state.pages;
      const moving = pages.filter((p) => selected.has(getPageId(p)));
      if (
        !moving.length ||
        !Number.isInteger(beforeIndex) ||
        beforeIndex < 0 ||
        beforeIndex > pages.length
      )
        return;
      const at = pages
        .slice(0, beforeIndex)
        .filter((p) => !selected.has(getPageId(p))).length;
      const rest = pages.filter((p) => !selected.has(getPageId(p)));
      rest.splice(at, 0, ...moving);
      if (rest.every((p, i) => p === pages[i])) return;
      commit(rest);
    },
    duplicatePages: (ids) => {
      const state = check();
      const selected = new Set(ids);
      const indexes = state.pages.flatMap((page, i) =>
        selected.has(getPageId(page)) ? [i] : [],
      );
      if (!indexes.length) return;
      insert(
        {
          pages: state.pages,
          fields: state.fields,
          annotations: state.annotations,
          preservedSourceAnnotations: state.preservedSourceAnnotations,
          indexes,
        },
        Math.max(...indexes) + 1,
      );
    },
    addBlankPages: ({ width, height, count, at }) => {
      const state = check();
      if (
        ![width, height].every(
          (value) => Number.isFinite(value) && value >= 1 && value <= 14400,
        ) ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > 1000
      )
        throw new Error("Invalid page dimensions or count");
      const pages: PageData[] = Array.from(
        { length: count },
        (_, pageIndex) => ({
          id: newId(),
          pageIndex,
          blank: true,
          width,
          height,
          viewBox: [0, 0, width, height],
          userUnit: 1,
          rotation: 0,
        }),
      );
      const next: PageData[] = identifyPages(state.pages);
      next.splice(
        Math.max(0, Math.min(next.length, Math.trunc(at))),
        0,
        ...pages,
      );
      commit(next, { selection: pages.map(getPageId) });
    },
    insertPdfPages: (payload, at) => insert(payload, at, payload.source),
  };
};
