import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EditorUiState } from "../types";
import { createEditorStoreState } from "@/store/createStoreState";
import { editorStorePersistConfig } from "@/store/persistConfig";
import type { EditorStore } from "@/store/store.types";

// Editor store = single source of truth (SSOT) for the editor.
//
// This store intentionally contains BOTH:
// - Document state: `pdfBytes/pages/fields/annotations/metadata/...`
// - UI state: sidebar/panels, tool selection, dialogs, etc.
//
// Persistence policy:
// - Only UI-related state is persisted to localStorage (see `partialize()` below).
// - Large/binary document data must NOT be persisted here.
//
// Extension guidance:
// - Adding a new Tool/FieldType usually means updating `types.ts` AND the reducers here
//   (e.g. selection rules, history snapshot scope).
// - If you add new editor UI state, decide whether it should be persisted in `pickEditorUiState()`.

export const useEditorStore = create<EditorStore>()(
  persist<EditorStore, [], [], Partial<EditorUiState>>(
    createEditorStoreState,
    editorStorePersistConfig,
  ),
);

export type { EditorActions, EditorStore } from "@/store/store.types";
