import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStampDrop } from "@/components/workspace/hooks/useWorkspaceStampDrop";
import { useStampLibraryStore } from "@/store/stampLibraryStore";
import * as stampImage from "@/lib/stampImage";
import { initialState } from "@/store/helpers";
import { UNRESTRICTED_PDF_PERMISSIONS } from "@/lib/pdfPermissions";
import type { WorkspaceEditorState } from "@/types";

const runtime = vi.hoisted(() => ({ active: true, disposed: false }));
vi.mock("@/app/editorTabs/context", () => ({
  useEditorTabRuntime: () => runtime,
}));

let host: HTMLDivElement;
let root: Root;
let state: { current: WorkspaceEditorState };
const addAnnotation = vi.fn();
const markUsed = vi.fn().mockResolvedValue(undefined);
const originalMarkUsed = useStampLibraryStore.getState().markUsed;
const findPage = vi.fn((): number | null => 0);
const image = {
  dataUrl: "data:image/png;base64,AA==",
  intrinsicSize: { width: 4000, height: 2000 },
};

const Harness = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { handlers } = useWorkspaceStampDrop({
    containerRef,
    editorStateRef: state,
    getPageIndexFromPoint: findPage,
    getRelativeCoordsFromPoint: () => ({ x: 200, y: 250 }),
    onAddAnnotation: addAnnotation,
  });
  return <div ref={containerRef} {...handlers} />;
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.active = true;
  runtime.disposed = false;
  addAnnotation.mockClear();
  markUsed.mockClear();
  findPage.mockReturnValue(0);
  state = {
    current: {
      ...initialState,
      documentLoadState: "ready",
      scale: 2,
      pages: [
        {
          pageIndex: 0,
          width: 600,
          height: 800,
          rotation: 0,
          userUnit: 1,
          viewBox: [0, 0, 600, 800],
        },
      ],
    },
  };
  useStampLibraryStore.setState({
    entries: [{ id: "saved", name: "Saved", image, createdAt: 1 }],
    markUsed,
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useStampLibraryStore.setState({ markUsed: originalMarkUsed });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const drop = async (files: File[] = []) => {
  const transfer = {
    types: files.length ? ["Files"] : [stampImage.STAMP_LIBRARY_DRAG_TYPE],
    items: files.map((file) => ({ kind: "file", type: file.type })),
    files,
    getData: () => (files.length ? "" : "saved"),
  };
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: transfer },
    clientX: { value: 400 },
    clientY: { value: 500 },
  });
  await act(async () => {
    host.firstElementChild!.dispatchEvent(event);
  });
};

describe("image drops", () => {
  it("creates a bounded stamp from the saved image without changing tools", async () => {
    await drop();
    expect(addAnnotation).toHaveBeenCalledOnce();
    expect(addAnnotation.mock.calls[0][0]).toMatchObject({
      type: "stamp",
      pageIndex: 0,
      rect: { x: 140, y: 220, width: 120, height: 60 },
      stamp: { kind: "image", image },
    });
    expect(markUsed).toHaveBeenCalledExactlyOnceWith("saved");
  });

  it("ignores drops outside a page, in inactive tabs and without annotation permission", async () => {
    findPage.mockReturnValue(null);
    await drop();
    findPage.mockReturnValue(0);
    runtime.active = false;
    await drop();
    runtime.active = true;
    state.current = {
      ...state.current,
      documentPermissions: {
        ...UNRESTRICTED_PDF_PERMISSIONS,
        canModifyAnnotations: false,
      },
    };
    await drop();
    expect(addAnnotation).not.toHaveBeenCalled();
    expect(markUsed).not.toHaveBeenCalled();
  });

  it.each(["closed", "removed page", "switched tab"])(
    "does not place a decoded image after %s",
    async (change) => {
      let finish!: (asset: stampImage.StampImageAsset) => void;
      vi.spyOn(stampImage, "loadStampImageFile").mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const add = vi.fn().mockResolvedValue(undefined);
      const originalAdd = useStampLibraryStore.getState().add;
      useStampLibraryStore.setState({ add });
      try {
        await drop([new File(["image"], "test.png", { type: "image/png" })]);
        if (change === "closed") runtime.disposed = true;
        if (change === "removed page")
          state.current = { ...state.current, pages: [] };
        if (change === "switched tab") runtime.active = false;
        await act(async () => {
          finish({
            dataUrl: image.dataUrl,
            width: 4000,
            height: 2000,
            name: "test.png",
          });
        });
        expect(addAnnotation).not.toHaveBeenCalled();
      } finally {
        useStampLibraryStore.setState({ add: originalAdd });
      }
    },
  );
});
