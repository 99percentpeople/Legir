import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWorkspaceDerivedPages } from "@/components/workspace/hooks/useWorkspaceDerivedPages";
import * as order from "@/lib/controlLayerOrder";
import type { Annotation, FormField, PageData } from "@/types";
import { field, page } from "../helpers/editorStore";

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let derived: ReturnType<typeof useWorkspaceDerivedPages<PageData>>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
function Probe(props: {
  pages: PageData[];
  fields: FormField[];
  annotations: Annotation[];
}) {
  derived = useWorkspaceDerivedPages({ ...props, pageLayout: "double_even" });
  return null;
}
const render = (props: React.ComponentProps<typeof Probe>) =>
  act(async () => root.render(<Probe {...props} />));

it("sorts only the affected page and retains unrelated page/control identities", async () => {
  const pages = Array.from({ length: 100 }, (_, i) => page(i));
  const annotations: Annotation[] = pages.map((p) => ({
    id: `a${p.pageIndex}`,
    type: "comment",
    pageIndex: p.pageIndex,
    rect: { x: 10, y: 20, width: 10, height: 10 },
    layerOrder: 1,
  }));
  const fields = [field("first", { layerOrder: 0 })];
  const sort = vi.spyOn(order, "getOrderedPageControls");
  await render({ pages, fields, annotations });
  const before = derived.pagesWithControls;
  expect(before[0].pageControls.map((entry) => entry.control.id)).toEqual([
    "first",
    "a0",
  ]);
  // Each sort receives just its page's bucket, never the full document.
  expect(sort.mock.calls.every(([f, a]) => f.length + a.length <= 2)).toBe(
    true,
  );
  sort.mockClear();
  const moved = annotations.map((a, i) =>
    i === 0 ? { ...a, rect: { ...a.rect!, x: 90 } } : a,
  );
  await render({ pages, fields, annotations: moved });
  expect(sort).toHaveBeenCalledTimes(1);
  expect(derived.pagesWithControls[0]).not.toBe(before[0]);
  for (let i = 1; i < pages.length; i++)
    expect(derived.pagesWithControls[i]).toBe(before[i]);
  expect(derived.pageRows[0][0]).toBe(derived.pagesWithControls[0]);
});

it("handles cross-page moves, deletion, undo and reordering without stale controls", async () => {
  const pages = [page(0), page(1), page(2)];
  const fields = [field("f")];
  const original: Annotation[] = [{ id: "a", type: "shape", pageIndex: 0 }];
  await render({ pages, fields, annotations: original });
  const untouched = derived.pagesWithControls[2];
  await render({
    pages,
    fields,
    annotations: [{ ...original[0], pageIndex: 1 }],
  });
  expect(derived.pagesWithControls[0].pageAnnotations).toEqual([]);
  expect(derived.pagesWithControls[1].pageControls[0].control.id).toBe("a");
  expect(derived.pagesWithControls[2]).toBe(untouched);
  await render({ pages, fields: [], annotations: [] });
  expect(
    derived.pagesWithControls.every((p) => p.pageControls.length === 0),
  ).toBe(true);
  await render({ pages, fields, annotations: original });
  expect(
    derived.pagesWithControls[0].pageControls.map((e) => e.control.id),
  ).toEqual(["f", "a"]);
  await render({
    pages,
    fields: [{ ...fields[0], layerOrder: 2 }],
    annotations: [{ ...original[0], layerOrder: 0 }],
  });
  expect(
    derived.pagesWithControls[0].pageControls.map((e) => e.control.id),
  ).toEqual(["a", "f"]);
  const rotated = { ...pages[0], rotation: 90 };
  await render({ pages: [rotated, pages[2]], fields, annotations: original });
  expect(derived.pagesWithControls[0].rotation).toBe(90);
  expect(derived.pagesWithControls).toHaveLength(2);
});
