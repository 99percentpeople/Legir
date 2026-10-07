import { beforeEach, describe, expect, it } from "vitest";
import {
  getDocumentViewState,
  saveDocumentViewState,
} from "@/services/platform/documentSession";

beforeEach(() => localStorage.clear());

const save = (path: string, page: number, scale: number, scrollTop: number) =>
  saveDocumentViewState({
    pdfFile: null,
    saveTarget: { kind: "tauri", path },
    currentPageIndex: page,
    scale,
    pendingViewStateRestore: { scale, scrollLeft: 15, scrollTop },
  });

describe("document viewport persistence", () => {
  it("restores each document independently after switching and reopening", () => {
    save("/a.pdf", 3, 1.5, 1250);
    save("/b.pdf", 7, 2, 3200);
    expect(
      getDocumentViewState({ sourceKey: "tauri:/a.pdf", pageCount: 10 }),
    ).toEqual({
      currentPageIndex: 3,
      pendingViewStateRestore: { scale: 1.5, scrollLeft: 15, scrollTop: 1250 },
    });
    expect(
      getDocumentViewState({ sourceKey: "tauri:/b.pdf", pageCount: 10 }),
    ).toEqual({
      currentPageIndex: 7,
      pendingViewStateRestore: { scale: 2, scrollLeft: 15, scrollTop: 3200 },
    });
    expect(
      getDocumentViewState({ sourceKey: "tauri:/c.pdf", pageCount: 10 }),
    ).toEqual({ currentPageIndex: 0, pendingViewStateRestore: null });
  });

  it("ignores old UI storage and validates the new document viewport format", () => {
    localStorage.setItem(
      "app-editor-ui-session",
      JSON.stringify({
        scale: 3,
        currentPageIndex: 9,
        sourceKey: "tauri:/a.pdf",
      }),
    );
    expect(
      getDocumentViewState({ sourceKey: "tauri:/a.pdf", pageCount: 10 })
        .pendingViewStateRestore,
    ).toBeNull();
    localStorage.setItem(
      "legir.document-views",
      JSON.stringify({
        "tauri:/a.pdf": { scale: "invalid", currentPageIndex: 2 },
      }),
    );
    expect(
      getDocumentViewState({ sourceKey: "tauri:/a.pdf", pageCount: 10 })
        .pendingViewStateRestore,
    ).toBeNull();
    save("/a.pdf", 10, 1.5, 500);
    expect(
      getDocumentViewState({ sourceKey: "tauri:/a.pdf", pageCount: 3 })
        .currentPageIndex,
    ).toBe(2);
    expect(
      Object.keys(
        JSON.parse(localStorage.getItem("legir.document-views")!)[
          "tauri:/a.pdf"
        ],
      ).sort(),
    ).toEqual(["currentPageIndex", "scale", "scrollLeft", "scrollTop"]);
  });
});
