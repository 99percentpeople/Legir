import { EditorViewContext } from "./editorViewContext";
import { useContext } from "react";
import { useStore } from "zustand";
import type { EditorState } from "../types";
import { setPdfPermissionPolicyProvider } from "@/lib/pdfPermissions";
import { preferencesStore } from "./preferencesStore";
import {
  createEditorView,
  selectedSubscription,
  type EditorViewApi,
} from "./editorView";
import type { EditorStore } from "./store.types";

// Home/window commands have an empty document owner. Preferences and layout
// have their own stores and survive closing the last document.
export const windowEditorView = createEditorView();
export const createDocumentEditorView = (state: Partial<EditorState>) => {
  const store = createEditorView({ state });
  return { store, dispose: store.dispose };
};

let activeStore: EditorViewApi = windowEditorView;
const activeListeners = new Set<
  (state: EditorStore, previous: EditorStore) => void
>();
let unsubscribeActive = activeStore.subscribe((state, previous) => {
  activeListeners.forEach((listener) => listener(state, previous));
});
export const getActiveEditorView = () => activeStore;
export const activateEditorView = (store: EditorViewApi = windowEditorView) => {
  if (activeStore === store) return;
  const previous = activeStore.getState();
  unsubscribeActive();
  activeStore = store;
  unsubscribeActive = store.subscribe((state, previous) =>
    activeListeners.forEach((listener) => listener(state, previous)),
  );
  activeListeners.forEach((listener) => listener(store.getState(), previous));
};
const activeView: EditorViewApi = {
  getState: () => activeStore.getState(),
  getInitialState: () => windowEditorView.getInitialState(),
  setState: ((...args: Parameters<EditorViewApi["setState"]>) =>
    activeStore.setState(...args)) as EditorViewApi["setState"],
  subscribe: selectedSubscription(
    (listener) => {
      activeListeners.add(listener);
      return () => {
        activeListeners.delete(listener);
      };
    },
    () => activeStore.getState(),
  ),
};

export { EditorViewContext } from "./editorViewContext";
export const useEditorViewApi = () =>
  useContext(EditorViewContext) ?? activeView;
export const useEditorView = Object.assign(
  <T = EditorStore>(
    selector: (state: EditorStore) => T = (state) => state as unknown as T,
  ): T => useStore(useEditorViewApi(), selector),
  activeView,
);
setPdfPermissionPolicyProvider(() => ({
  ignorePdfPermissions:
    preferencesStore.getState().options.debugOptions.ignorePdfPermissions,
}));
export type { EditorViewApi } from "./editorView";
export type { EditorActions, EditorStore } from "./store.types";
