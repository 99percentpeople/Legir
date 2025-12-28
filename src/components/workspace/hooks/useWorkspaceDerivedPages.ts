import { useMemo } from "react";
import type { Annotation, FormField } from "@/types";

export const useWorkspaceDerivedPages = <
  TPage extends { pageIndex: number },
>(opts: {
  pages: TPage[];
  fields: FormField[];
  annotations: Annotation[];
  pageLayout: "single" | "double";
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
    if (opts.pageLayout !== "double")
      return [] as Array<typeof pagesWithControls>;
    const rows: Array<typeof pagesWithControls> = [];
    for (let i = 0; i < pagesWithControls.length; i += 2) {
      rows.push(pagesWithControls.slice(i, i + 2));
    }
    return rows;
  }, [opts.pageLayout, pagesWithControls]);

  return { controlsByPage, pagesWithControls, pageRows };
};
