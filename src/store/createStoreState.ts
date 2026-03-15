import { initialState } from "@/store/helpers";
import {
  createAppStateSlice,
  createControlSlice,
  createDocumentSlice,
  createHistorySlice,
  createPageTranslateSlice,
  createRuntimeSlice,
  createSettingsSlice,
  createUiSlice,
} from "@/store/slices";
import type { EditorStoreStateCreator } from "@/store/store.types";

// Compose a single editor store out of domain-focused slices.
// The runtime model remains "one store", but the implementation stays modular.
export const createEditorStoreState: EditorStoreStateCreator = (set, get) => ({
  ...initialState,
  ...createAppStateSlice(set, get),
  ...createControlSlice(set, get),
  ...createDocumentSlice(set, get),
  ...createUiSlice(set, get),
  ...createSettingsSlice(set, get),
  ...createRuntimeSlice(set, get),
  ...createHistorySlice(set, get),
  ...createPageTranslateSlice(set, get),
});
