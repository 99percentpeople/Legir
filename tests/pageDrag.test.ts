import { expect, it } from "vitest";
import {
  fileInsertionIndex,
  previewPageMove,
} from "@/components/page-editor/pageDrag";
import { insertionIndex } from "@/components/page-editor/InsertionPosition";
import { getPageId } from "@/services/pdfService/lib/pageStructure";
import { createTestEditorStore, field, page } from "./helpers/editorStore";

it("keeps untouched pages and controls when sorting pages without source identities", () => {
  const pages = Array.from({ length: 6 }, (_, i) => page(i));
  const fields = [field("moving"), field("stationary", { pageIndex: 4 })];
  const store = createTestEditorStore({ pages, fields });
  try {
    store.getState().movePages(["original:0"], 3);
    const moved = store.getState();
    expect(moved.pages.map(getPageId)).toEqual([
      "original:1",
      "original:2",
      "original:0",
      "original:3",
      "original:4",
      "original:5",
    ]);
    expect(moved.pages.map((page) => page.pageIndex)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(moved.pages[2].source).toEqual({
      documentId: "default",
      pageIndex: 0,
    });
    for (let i = 3; i < pages.length; i++)
      expect(moved.pages[i]).toBe(pages[i]);
    expect(moved.fields[0].pageIndex).toBe(2);
    expect(moved.fields[1]).toBe(fields[1]);
    expect(pages[0].pageIndex).toBe(0);
    expect(pages[0].source).toBeUndefined();
    expect(fields[0].pageIndex).toBe(0);
    expect(moved.past).toHaveLength(1);
    store.getState().movePages(["original:0"], 3);
    expect(store.getState().pages).toBe(moved.pages);
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().pages).toBe(pages);
    expect(store.getState().fields).toBe(fields);
    store.getState().redo();
    expect(store.getState().pages).toBe(moved.pages);
  } finally {
    store.dispose();
  }
});

it("previews a nonadjacent selected block in document order without mutating pages", () => {
  const pages = Array.from({ length: 6 }, (_, i) => ({
    ...page(i),
    id: String(i),
  }));
  const preview = previewPageMove(pages, new Set(["2", "0"]), 6);
  expect(preview.map((p) => p.id)).toEqual(["1", "3", "4", "5", "0", "2"]);
  expect(preview[4]).toBe(pages[0]);
  expect(pages.map((p) => p.pageIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(
    previewPageMove(pages, new Set(["3", "5"]), 0).map((p) => p.id),
  ).toEqual(["3", "5", "0", "1", "2", "4"]);
});

it("maps file drop halves, row breaks and empty trailing space to insertion gaps", () => {
  expect(fileInsertionIndex(20, 20, 800, 4, 10, 252)).toBe(0);
  expect(fileInsertionIndex(180, 20, 800, 4, 10, 252)).toBe(1);
  expect(fileInsertionIndex(20, 270, 800, 4, 10, 252)).toBe(4);
  expect(fileInsertionIndex(780, 600, 800, 4, 10, 252)).toBe(10);
  expect(fileInsertionIndex(20, 1200, 800, 4, 10, 252)).toBe(10);
  expect(fileInsertionIndex(20, 810, 1000, 3, 20, 400)).toBe(6);
  expect(fileInsertionIndex(980, 810, 1000, 3, 20, 400)).toBe(9);
});

it("validates explicit page destinations and requires a selection for relative ones", () => {
  expect(insertionIndex("before_page", 3, 10, [])).toBe(2);
  expect(insertionIndex("after_page", 3, 10, [])).toBe(3);
  expect(insertionIndex("before_page", 0, 10, [])).toBeNull();
  expect(insertionIndex("after_page", 11, 10, [])).toBeNull();
  expect(insertionIndex("after", 1, 10, [])).toBeNull();
  expect(insertionIndex("after", 1, 10, [1, 4])).toBe(5);
});
