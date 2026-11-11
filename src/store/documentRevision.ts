import type { EditorState, SavedDocumentRevision } from "@/types";

/** Keep immutable content references, without view state or history stacks. */
export const captureDocumentRevision = (
  state: EditorState,
): SavedDocumentRevision => ({
  pdfBytes: state.pdfBytes,
  pages: state.pages,
  pageSources: state.pageSources,
  fields: state.fields,
  annotations: state.annotations,
  metadata: state.metadata,
  outline: state.outline,
  preservedSourceAnnotations: state.preservedSourceAnnotations,
  exportPassword: state.exportPassword,
  pdfOwnerPassword: state.pdfOwnerPassword,
  preservePdfOwnerRestrictionsOnSave: state.preservePdfOwnerRestrictionsOnSave,
  removeTextUnderFlattenedFreetext:
    state.options.removeTextUnderFlattenedFreetext,
});

// Undo normally restores the same references. Value comparison also handles
// snapshots cloned when a document is transferred to another window.
function equalContent(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    return (
      a instanceof Uint8Array &&
      b instanceof Uint8Array &&
      a.length === b.length &&
      a.every((value, index) => value === b[index])
    );
  }
  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => equalContent(value, b[index]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        equalContent(left[key], right[key]),
    )
  );
}

export const matchesDocumentRevision = (
  state: EditorState,
  revision: SavedDocumentRevision,
) => equalContent(captureDocumentRevision(state), revision);
