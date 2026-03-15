import type { HistorySnapshot } from "@/types";
import type { EditorActions, EditorStoreSlice } from "@/store/store.types";

// History intentionally snapshots editable PDF artifacts only. Runtime/UI state
// is excluded so undo/redo stays focused on user-authored document changes.
export const createHistorySlice: EditorStoreSlice<
  Pick<EditorActions, "saveCheckpoint" | "undo" | "redo">
> = (set) => ({
  saveCheckpoint: () => {
    set((state) => {
      const snapshot: HistorySnapshot = {
        fields: state.fields,
        annotations: state.annotations,
        metadata: state.metadata,
        exportPassword: state.exportPassword,
      };
      const newPast = [...state.past, snapshot].slice(-50);
      return { ...state, past: newPast, future: [] };
    });
  },

  undo: () => {
    set((state) => {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      const newPast = state.past.slice(0, -1);
      const currentSnapshot: HistorySnapshot = {
        fields: state.fields,
        annotations: state.annotations,
        metadata: state.metadata,
        exportPassword: state.exportPassword,
      };
      return {
        ...state,
        fields: previous.fields,
        annotations: previous.annotations,
        metadata: previous.metadata,
        exportPassword: previous.exportPassword,
        past: newPast,
        future: [currentSnapshot, ...state.future],
        selectedId: null,
        isDirty: true,
      };
    });
  },

  redo: () => {
    set((state) => {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      const newFuture = state.future.slice(1);
      const currentSnapshot: HistorySnapshot = {
        fields: state.fields,
        annotations: state.annotations,
        metadata: state.metadata,
        exportPassword: state.exportPassword,
      };
      return {
        ...state,
        fields: next.fields,
        annotations: next.annotations,
        metadata: next.metadata,
        exportPassword: next.exportPassword,
        past: [...state.past, currentSnapshot],
        future: newFuture,
        selectedId: null,
        isDirty: true,
      };
    });
  },
});
