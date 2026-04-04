import { createJSONStorage, type PersistOptions } from "zustand/middleware";

import type { EditorState } from "../types";
import type { EditorUiState } from "@/types";
import { mergeEditorOptions, pickEditorUiState } from "@/store/helpers";
import type { EditorStore } from "@/store/store.types";

// Persist only editor UI preferences. Large document/runtime state is restored
// elsewhere and should not be written into localStorage.
export const editorStorePersistConfig: PersistOptions<
  EditorStore,
  Partial<EditorUiState>
> = {
  name: "app-editor-ui-dev",
  version: 1,
  storage: createJSONStorage<Partial<EditorUiState>>(() => localStorage),
  partialize: (state: EditorStore) => pickEditorUiState(state),
  merge: (persistedState: unknown, currentState: EditorStore): EditorStore => {
    // Rehydrate persisted UI, then re-normalize nested option trees so env
    // defaults and legacy AI config migrations still apply on startup.
    const persisted = persistedState as Partial<EditorState>;
    return {
      ...currentState,
      ...persisted,
      options: mergeEditorOptions(currentState.options, persisted.options),
    };
  },
};
