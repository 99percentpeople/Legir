import { mergeEditorOptions } from "@/store/helpers";
import type { EditorActions, EditorStoreSlice } from "@/store/store.types";

// Settings slice owns nested app options so callers do not need to remember
// how llm/debug/snapping/aiChat subtrees should be merged.
export const createSettingsSlice: EditorStoreSlice<
  Pick<EditorActions, "setOptions">
> = (set) => ({
  setOptions: (updates) =>
    set((state) => {
      const patch =
        typeof updates === "function" ? updates(state.options) : updates;
      return {
        ...state,
        options: mergeEditorOptions(state.options, patch),
      };
    }),
});
