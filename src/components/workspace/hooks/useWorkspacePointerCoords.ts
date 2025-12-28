import {
  useCallback,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import type { EditorState } from "@/types";

export const useWorkspacePointerCoords = (opts: {
  editorStateRef: RefObject<EditorState>;
}) => {
  const getRelativeCoordsFromPoint = useCallback(
    (clientX: number, clientY: number, pageIndex: number) => {
      const pageEl = document.getElementById(`page-${pageIndex}`);
      if (!pageEl) return { x: 0, y: 0 };
      const rect = pageEl.getBoundingClientRect();
      const scale = opts.editorStateRef.current?.scale ?? 1;
      return {
        x: (clientX - rect.left) / scale,
        y: (clientY - rect.top) / scale,
      };
    },
    [opts.editorStateRef],
  );

  const getRelativeCoords = useCallback(
    (e: ReactMouseEvent | MouseEvent, pageIndex: number) => {
      // IMPORTANT: Get coords relative to the container wrapper using stable ID
      return getRelativeCoordsFromPoint(e.clientX, e.clientY, pageIndex);
    },
    [getRelativeCoordsFromPoint],
  );

  return { getRelativeCoordsFromPoint, getRelativeCoords };
};
