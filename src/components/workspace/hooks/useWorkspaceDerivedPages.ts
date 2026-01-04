import { useMemo } from "react";
import type { Annotation, FormField, PageLayoutMode } from "@/types";

export const useWorkspaceDerivedPages = <
  TPage extends { pageIndex: number },
>(opts: {
  pages: TPage[];
  fields: FormField[];
  annotations: Annotation[];
  pageLayout: PageLayoutMode;
}) => {
  const controlsByPage = useMemo(() => {
    const fieldsByPage = new Map<number, FormField[]>();
    const annotationsByPage = new Map<number, Annotation[]>();

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

    return { fieldsByPage, annotationsByPage };
  }, [opts.fields, opts.annotations]);

  const pagesWithControls = useMemo(() => {
    return opts.pages.map((page) => {
      return {
        ...page,
        pageAnnotations:
          controlsByPage.annotationsByPage.get(page.pageIndex) ?? [],
        pageFields: controlsByPage.fieldsByPage.get(page.pageIndex) ?? [],
      };
    });
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
