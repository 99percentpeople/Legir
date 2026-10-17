import { useMemo, useRef } from "react";
import type { Annotation, FormField, PageLayoutMode } from "@/types";
import { getOrderedPageControls } from "@/lib/controlLayerOrder";

const sameItems = <T>(left: T[] | undefined, right: T[]) =>
  left?.length === right.length &&
  right.every((item, index) => item === left[index]);

const emptyFields: FormField[] = [];
const emptyAnnotations: Annotation[] = [];
const emptyControls: ReturnType<typeof getOrderedPageControls> = [];

type PageControls = {
  fieldsByPage: Map<number, FormField[]>;
  annotationsByPage: Map<number, Annotation[]>;
  orderedControlsByPage: Map<number, ReturnType<typeof getOrderedPageControls>>;
};

export const useWorkspaceDerivedPages = <
  TPage extends { pageIndex: number },
>(opts: {
  pages: TPage[];
  fields: FormField[];
  annotations: Annotation[];
  pageLayout: PageLayoutMode;
}) => {
  const previousControls = useRef<PageControls | null>(null);
  const controlsByPage = useMemo(() => {
    const fieldsByPage = new Map<number, FormField[]>();
    const annotationsByPage = new Map<number, Annotation[]>();
    const orderedControlsByPage = new Map<
      number,
      ReturnType<typeof getOrderedPageControls>
    >();

    for (const f of opts.fields) {
      const arr = fieldsByPage.get(f.pageIndex);
      if (arr) arr.push(f);
      else fieldsByPage.set(f.pageIndex, [f]);
    }

    for (const a of opts.annotations) {
      const arr = annotationsByPage.get(a.pageIndex);
      if (arr) arr.push(a);
      else annotationsByPage.set(a.pageIndex, [a]);
    }

    const pageIndexes = new Set<number>([
      ...fieldsByPage.keys(),
      ...annotationsByPage.keys(),
    ]);
    for (const pageIndex of pageIndexes) {
      const previous = previousControls.current;
      let fields = fieldsByPage.get(pageIndex) ?? emptyFields;
      let annotations = annotationsByPage.get(pageIndex) ?? emptyAnnotations;
      const oldFields = previous?.fieldsByPage.get(pageIndex) ?? emptyFields;
      const oldAnnotations =
        previous?.annotationsByPage.get(pageIndex) ?? emptyAnnotations;
      if (sameItems(oldFields, fields)) fields = oldFields;
      if (sameItems(oldAnnotations, annotations)) annotations = oldAnnotations;
      fieldsByPage.set(pageIndex, fields);
      annotationsByPage.set(pageIndex, annotations);
      orderedControlsByPage.set(
        pageIndex,
        fields === oldFields && annotations === oldAnnotations
          ? (previous?.orderedControlsByPage.get(pageIndex) ?? emptyControls)
          : getOrderedPageControls(fields, annotations, pageIndex),
      );
    }

    // Retain only this revision. Published maps/arrays are never mutated, so
    // undo, cross-page moves and interrupted React renders can safely reuse them.
    const next = { fieldsByPage, annotationsByPage, orderedControlsByPage };
    previousControls.current = next;
    return next;
  }, [opts.fields, opts.annotations]);

  type DerivedPage = TPage & {
    pageAnnotations: Annotation[];
    pageFields: FormField[];
    pageControls: ReturnType<typeof getOrderedPageControls>;
  };
  const previousPages = useRef(new Map<TPage, DerivedPage>());
  const pagesWithControls = useMemo(() => {
    const next = new Map<TPage, DerivedPage>();
    const result = opts.pages.map((page) => {
      const pageAnnotations =
        controlsByPage.annotationsByPage.get(page.pageIndex) ??
        emptyAnnotations;
      const pageFields =
        controlsByPage.fieldsByPage.get(page.pageIndex) ?? emptyFields;
      const pageControls =
        controlsByPage.orderedControlsByPage.get(page.pageIndex) ??
        emptyControls;
      const previous = previousPages.current.get(page);
      const derived =
        previous?.pageAnnotations === pageAnnotations &&
        previous.pageFields === pageFields &&
        previous.pageControls === pageControls
          ? previous
          : {
              ...page,
              pageAnnotations,
              pageFields,
              pageControls,
            };
      next.set(page, derived);
      return derived;
    });
    previousPages.current = next;
    return result;
  }, [opts.pages, controlsByPage]);

  const pageRows = useMemo(() => {
    if (opts.pageLayout === "single")
      return [] as Array<Array<(typeof pagesWithControls)[number]>>;

    const rows: Array<Array<(typeof pagesWithControls)[number]>> = [];
    if (pagesWithControls.length === 0) return rows;

    const startIndex = opts.pageLayout === "double_even" ? 1 : 0;
    if (opts.pageLayout === "double_even") {
      if (pagesWithControls[0]) rows.push([pagesWithControls[0]]);
    }

    for (let i = startIndex; i < pagesWithControls.length; i += 2) {
      const left = pagesWithControls[i];
      if (!left) continue;
      const right = pagesWithControls[i + 1];
      if (right) rows.push([left, right]);
      else rows.push([left]);
    }

    return rows;
  }, [opts.pageLayout, pagesWithControls]);

  return { controlsByPage, pagesWithControls, pageRows };
};
