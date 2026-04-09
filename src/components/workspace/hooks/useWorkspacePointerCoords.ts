import {
  useCallback,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import type { WorkspaceEditorState } from "@/types";

type PageRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export const useWorkspacePointerCoords = (opts: {
  editorStateRef: RefObject<Pick<WorkspaceEditorState, "scale">>;
  contentRef?: RefObject<HTMLElement | null>;
  getPageRectByPageIndex?: (pageIndex: number) => PageRect | null;
}) => {
  // Prefer DOM measurement when the page is mounted (accurate and cheap).
  // Fallback to rect-based math when virtualization means the page element is missing.
  const getRelativeCoordsFromPointDom = useCallback(
    (clientX: number, clientY: number, pageIndex: number) => {
      const pageEl = document.getElementById(`page-${pageIndex}`);
      if (!pageEl) return null;
      const rect = pageEl.getBoundingClientRect();
      const scale = opts.editorStateRef.current?.scale ?? 1;
      return {
        x: (clientX - rect.left) / scale,
        y: (clientY - rect.top) / scale,
      };
    },
    [opts.editorStateRef],
  );

  const getRelativeCoordsFromPointVirtual = useCallback(
    (clientX: number, clientY: number, pageIndex: number) => {
      const contentEl = opts.contentRef?.current;
      const getRect = opts.getPageRectByPageIndex;
      if (!contentEl || !getRect) return null;

      const pageRect = getRect(pageIndex);
      if (!pageRect) return null;

      const contentBox = contentEl.getBoundingClientRect();
      const scale = opts.editorStateRef.current?.scale ?? 1;
      return {
        x: (clientX - contentBox.left - pageRect.left) / scale,
        y: (clientY - contentBox.top - pageRect.top) / scale,
      };
    },
    [opts.contentRef, opts.editorStateRef, opts.getPageRectByPageIndex],
  );

  const getRelativeCoordsFromPoint = useCallback(
    (clientX: number, clientY: number, pageIndex: number) => {
      return (
        getRelativeCoordsFromPointDom(clientX, clientY, pageIndex) ??
        getRelativeCoordsFromPointVirtual(clientX, clientY, pageIndex) ?? {
          x: 0,
          y: 0,
        }
      );
    },
    [getRelativeCoordsFromPointDom, getRelativeCoordsFromPointVirtual],
  );

  const getRelativeCoords = useCallback(
    (e: ReactMouseEvent | MouseEvent, pageIndex: number) => {
      // IMPORTANT: Return coordinates in *PDF space* (screen px -> divide by scale).
      return getRelativeCoordsFromPoint(e.clientX, e.clientY, pageIndex);
    },
    [getRelativeCoordsFromPoint, getRelativeCoordsFromPointVirtual],
  );

  return { getRelativeCoordsFromPoint, getRelativeCoords };
};
