import { DEFAULT_EDITOR_UI_STATE } from "@/constants";
import type { EditorActions, EditorStoreSlice } from "@/store/store.types";

// UI slice is limited to persisted UI panel/dialog state, distinct from
// document mutations and ephemeral runtime coordination.
export const createUiSlice: EditorStoreSlice<
  Pick<EditorActions, "setUiState" | "resetUiState">
> = (set) => ({
  setUiState: (updates) =>
    set((state) => {
      const nextValues =
        typeof updates === "function" ? updates(state) : updates;
      return { ...state, ...nextValues };
    }),

  resetUiState: () => set({ ...DEFAULT_EDITOR_UI_STATE }),
});
