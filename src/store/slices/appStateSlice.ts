import { normalizeEditorOptions } from "@/store/helpers";
import type { EditorActions, EditorStoreSlice } from "@/store/store.types";

// App-state slice exposes the generic "patch the store" escape hatch.
// Keep this small so most domain logic still lives in focused slices.
export const createAppStateSlice: EditorStoreSlice<
  Pick<EditorActions, "setState">
> = (set) => ({
  setState: (updates) =>
    set((state) => {
      const nextValues =
        typeof updates === "function" ? updates(state) : updates;
      const ownsOptions = Object.prototype.hasOwnProperty.call(
        nextValues,
        "options",
      );
      if (
        !ownsOptions ||
        !nextValues.options ||
        nextValues.options === state.options
      ) {
        return nextValues;
      }

      return {
        ...nextValues,
        options: normalizeEditorOptions(nextValues.options),
      };
    }),
});
