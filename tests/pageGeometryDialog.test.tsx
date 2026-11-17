import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PageCropMargins, PageData } from "@legir/pdf-model";
import {
  cropPageGeometry,
  resizePageGeometry,
} from "@legir/pdf-model/pageGeometry";
import { getPageId } from "@legir/pdf-core/lib/pageStructure";
import { PageGeometryDialog } from "@/components/page-editor/PageGeometryDialog";
import type { PageGeometryPreview } from "@/components/page-editor/PageGeometryPreview";
import { getPageView } from "@/components/workspace/lib/pageViewRotation";
import { EditorViewContext } from "@/store/useEditorView";
import { createTestEditorStore } from "./helpers/editorStore";

let preview: React.ComponentProps<typeof PageGeometryPreview>;
vi.mock("@/components/page-editor/PageGeometryPreview", () => ({
  PageGeometryPreview: (props: typeof preview) => {
    preview = props;
    return <div data-page-geometry-preview tabIndex={-1} />;
  },
}));
vi.mock("@/components/language-provider", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const source: PageData = {
  id: "page-0",
  pageIndex: 0,
  width: 400,
  height: 600,
  viewBox: [0, 0, 400, 600],
  userUnit: 1,
  rotation: 0,
};
const crop: PageCropMargins = { top: 10, right: 20, bottom: 30, left: 40 };
let host: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof createTestEditorStore>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  store = createTestEditorStore({ pages: [source] });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  store.dispose();
  vi.unstubAllGlobals();
});
const open = async () => {
  await act(async () => root.render(null));
  await act(async () =>
    root.render(
      <EditorViewContext.Provider value={store}>
        <PageGeometryDialog
          mode="crop"
          ids={store.getState().pages.map(getPageId)}
          worker={null}
          onClose={() => root.render(null)}
        />
      </EditorViewContext.Provider>,
    ),
  );
};
const click = async (action: string) => {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((element) => element.textContent === action)!;
  expect(button).toBeDefined();
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
};
const apply = () => click("page_editor.geometry.apply");
const expectPaper = (width: number, height: number) => {
  const full = getPageView(preview.page, 0);
  expect(full.width).toBeCloseTo(width, 8);
  expect(full.height).toBeCloseTo(height, 8);
};
const expectMargins = (expected: PageCropMargins) => {
  for (const side of ["top", "right", "bottom", "left"] as const)
    expect(preview.margins![side]).toBeCloseTo(expected[side], 8);
};

it("reopens on the full paper with the current crop and applies absolute margins", async () => {
  await open();
  await act(async () => preview.onMargins!(crop));
  await apply();
  const cropped = store.getState().pages[0];
  expect(getPageView(cropped, 0)).toMatchObject({ width: 340, height: 560 });

  // Confirming the current frame again must not cut off another set of margins.
  for (let i = 0; i < 2; i++) {
    await open();
    expectPaper(400, 600);
    expectMargins(crop);
    await apply();
    expect(store.getState().pages[0].geometry).toEqual(cropped.geometry);
  }

  await open();
  const expanded = { top: 2, right: 4, bottom: 6, left: 8 };
  await act(async () => preview.onMargins!(expanded));
  await apply();
  expect(getPageView(store.getState().pages[0], 0)).toMatchObject({
    width: 388,
    height: 592,
  });
  store.getState().undo();
  expect(store.getState().pages[0].geometry).toEqual(cropped.geometry);
});

it("keeps opening and cancelling read-only, and resets the frame before a new crop", async () => {
  store.getState().cropPages([source.id!], crop);
  const before = store.getState();
  await open();
  expect(store.getState().pages).toBe(before.pages);
  await click("common.actions.cancel");
  expect(store.getState().past).toBe(before.past);
  expect(store.getState().pages).toBe(before.pages);

  await open();
  await click("page_editor.geometry.reset_crop");
  expectPaper(400, 600);
  expectMargins({ top: 0, right: 0, bottom: 0, left: 0 });
  await act(async () => preview.onMargins!({ ...crop, top: 5 }));
  await apply();
  expect(store.getState().past).toHaveLength(before.past.length + 1);
  store.getState().undo();
  expect(store.getState().pages).toBe(before.pages);
});

it.each([0, 90, 180, 270])(
  "uses the resized paper and its saved rotation (%i degrees)",
  async (rotationDelta) => {
    const rotated = { ...source, rotationDelta };
    const resized = {
      ...rotated,
      geometry: resizePageGeometry(rotated, {
        width: 842,
        height: 595,
        content: "fit",
        anchorX: 0.5,
        anchorY: 0.5,
      }),
    };
    const cropped = { ...resized, geometry: cropPageGeometry(resized, crop) };
    store.setState({ pages: [cropped] });
    await open();
    expectPaper(842, 595);
    expectMargins(crop);
    await apply();
    expect(getPageView(store.getState().pages[0], 0).width).toBeCloseTo(782, 8);
    expect(getPageView(store.getState().pages[0], 0).height).toBeCloseTo(
      555,
      8,
    );
  },
);

it.each([
  [0, { top: 60, right: 120, bottom: 140, left: 80 }],
  [90, { top: 80, right: 60, bottom: 120, left: 140 }],
  [180, { top: 140, right: 80, bottom: 60, left: 120 }],
  [270, { top: 120, right: 140, bottom: 80, left: 60 }],
] as const)(
  "restores an imported CropBox frame with UserUnit and native rotation (additional rotation %i)",
  async (rotationDelta, expected) => {
    store.setState({
      pages: [
        {
          ...source,
          width: 1400,
          height: 1000,
          viewBox: [30, 40, 530, 740],
          sourceMediaBox: [0, 0, 600, 800],
          userUnit: 2,
          rotation: 90,
          rotationDelta,
        },
      ],
    });
    await open();
    const swap = rotationDelta === 90 || rotationDelta === 270;
    expectPaper(swap ? 1200 : 1600, swap ? 1600 : 1200);
    expectMargins(expected);
    await apply();
    const result = getPageView(store.getState().pages[0], 0);
    expect(result.width).toBeCloseTo(swap ? 1000 : 1400, 8);
    expect(result.height).toBeCloseTo(swap ? 1400 : 1000, 8);
  },
);

it("applies shared margins from each selected page's full paper in one undo step", async () => {
  const second = {
    ...source,
    id: "page-1",
    pageIndex: 1,
    width: 600,
    height: 800,
    viewBox: [0, 0, 600, 800] as PageData["viewBox"],
  };
  store.setState({
    pages: [
      { ...source, geometry: cropPageGeometry(source, crop) },
      { ...second, geometry: cropPageGeometry(second, { ...crop, left: 60 }) },
    ],
  });
  const before = store.getState();
  await open();
  await apply();
  expect(
    store.getState().pages.map((page) => getPageView(page, 0).width),
  ).toEqual([340, 540]);
  expect(store.getState().past).toHaveLength(before.past.length + 1);
  store.getState().undo();
  expect(store.getState().pages).toBe(before.pages);
});
