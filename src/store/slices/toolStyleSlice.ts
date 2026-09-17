import { shallow } from "zustand/shallow";
import { ANNOTATION_STYLES } from "@/constants";
import type {
  EditorActions,
  EditorStoreSlice,
  EditorToolStyles,
} from "@/store/store.types";

const defaultStyles: EditorToolStyles = {
  penStyle: ANNOTATION_STYLES.ink,
  highlightStyle: ANNOTATION_STYLES.highlight,
  commentStyle: ANNOTATION_STYLES.comment,
  freetextStyle: ANNOTATION_STYLES.freetext,
  shapeStyle: ANNOTATION_STYLES.shape,
  stampStyle: ANNOTATION_STYLES.stamp,
};

// These are defaults for future annotations, not document edits. Changing a
// tool style must not create history entries or permission-dirty scopes.
export const createToolStyleSlice: EditorStoreSlice<
  Pick<EditorActions, "updateToolStyle">
> = (set) => ({
  updateToolStyle: (kind, patch) =>
    set((state) => {
      if (Object.keys(patch).length === 0) return state;
      const current = state[kind];
      const next = { ...defaultStyles[kind], ...current, ...patch };
      return shallow(current, next) ? state : { [kind]: next };
    }),
});
