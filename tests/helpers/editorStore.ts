import { createEditorView } from "@/store/editorView";
import { createPreferencesStore } from "@/store/preferencesStore";
import { createWorkspaceStore } from "@/store/workspaceStore";
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

export const createTestEditorStore = (overrides: Partial<EditorState> = {}) => {
  const preferences = createPreferencesStore(false);
  const workspace = createWorkspaceStore(false);
  const view = createEditorView({ preferences, workspace });
  view.setState({
    documentLoadState: "ready",
    pages: [page()],
    pdfBytes: new Uint8Array([1]),
    isPanelFloating: false,
    isSidebarOpen: false,
    isRightPanelOpen: false,
    ...overrides,
  });
  return view;
};
