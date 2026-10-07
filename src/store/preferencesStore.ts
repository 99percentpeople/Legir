import { useContext } from "react";
import { EditorViewContext } from "./editorViewContext";
import type { EditorView } from "./editorView";
import { createStore, useStore } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { EditorPreferencesState } from "@/types";
import { initialState, mergeEditorOptions } from "./helpers";
import { pickState, preferenceKeys } from "./stateDomains";

export const createPreferencesStore = (persistent = true) => {
  const defaults = pickState(initialState, preferenceKeys);
  if (!persistent) return createStore<EditorPreferencesState>(() => defaults);
  return createStore<EditorPreferencesState>()(
    persist(() => defaults, {
      name: "legir.preferences",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) =>
        pickState(
          state,
          preferenceKeys.filter((key) => key !== "llmModelCache"),
        ),
      merge: (saved, current) => {
        if (!saved || typeof saved !== "object") return current;
        const preferences = saved as Partial<EditorPreferencesState>;
        return {
          ...current,
          ...pickState({ ...current, ...preferences }, preferenceKeys),
          llmModelCache: current.llmModelCache,
          options: mergeEditorOptions(current.options, preferences.options),
        };
      },
    }),
  );
};

export const preferencesStore = createPreferencesStore();
export const usePreferencesStore = <T>(
  selector: (state: EditorPreferencesState) => T,
) => {
  const context = useContext(EditorViewContext);
  const owner =
    context && "preferences" in context
      ? (context as EditorView).preferences
      : preferencesStore;
  return useStore(owner, selector);
};

export const setPreferenceOptions = (
  updates:
    | Partial<EditorPreferencesState["options"]>
    | ((
        current: EditorPreferencesState["options"],
      ) => Partial<EditorPreferencesState["options"]>),
) => {
  const current = preferencesStore.getState().options;
  preferencesStore.setState({
    options: mergeEditorOptions(
      current,
      typeof updates === "function" ? updates(current) : updates,
    ),
  });
};
