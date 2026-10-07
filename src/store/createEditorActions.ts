import {
  createAppStateSlice,
  createControlSlice,
  createDocumentSlice,
  createEditorViewSlice,
  createHistorySlice,
  createPageTranslateSlice,
  createRuntimeSlice,
  createSettingsSlice,
  createUiSlice,
  createToolStyleSlice,
} from "@/store/slices";
import type { EditorStoreStateCreator } from "@/store/store.types";

// Commands read a composed editor view and write through its domain owners.
export const createEditorActions = (
  set: Parameters<EditorStoreStateCreator>[0],
  get: Parameters<EditorStoreStateCreator>[1],
) => ({
  ...createAppStateSlice(set, get),
  ...createControlSlice(set, get),
  ...createDocumentSlice(set, get),
  ...createEditorViewSlice(set, get),
  ...createUiSlice(set, get),
  ...createToolStyleSlice(set, get),
  ...createSettingsSlice(set, get),
  ...createRuntimeSlice(set, get),
  ...createHistorySlice(set, get),
  ...createPageTranslateSlice(set, get),
});
