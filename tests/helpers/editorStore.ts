import { createStore } from "zustand/vanilla";
import { subscribeWithSelector } from "zustand/middleware";
import { createEditorStoreState } from "@/store/createStoreState";
import type { EditorStore } from "@/store/store.types";
import {
  FieldType,
  type EditorState,
  type FormField,
  type PageData,
  type PageTranslateParagraphCandidate,
} from "@/types";

export const page = (pageIndex = 0): PageData => ({
  pageIndex,
  width: 600,
  height: 800,
  viewBox: [0, 0, 600, 800],
  userUnit: 1,
  rotation: 0,
});

export const field = (
  id = "field-1",
  patch: Partial<FormField> = {},
): FormField => ({
  id,
  name: id,
  type: FieldType.TEXT,
  pageIndex: 0,
  rect: { x: 10, y: 10, width: 100, height: 20 },
  ...patch,
});

export const candidate = (
  id: string,
  patch: Partial<PageTranslateParagraphCandidate> = {},
): PageTranslateParagraphCandidate => ({
  id,
  pageIndex: 0,
  rect: { x: 10, y: 10, width: 100, height: 20 },
  sourceText: id,
  fontSize: 12,
  fontFamily: "Helvetica",
  isExcluded: false,
  ...patch,
});

export const createTestEditorStore = (overrides: Partial<EditorState> = {}) =>
  createStore<EditorStore>()(
    subscribeWithSelector((set, get, api) => ({
      ...createEditorStoreState(set, get, api),
      documentLoadState: "ready",
      pages: [page()],
      pdfBytes: new Uint8Array([1]),
      isPanelFloating: false,
      isSidebarOpen: false,
      isRightPanelOpen: false,
      ...overrides,
    })),
  );
