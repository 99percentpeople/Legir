import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Annotation, EditorState } from "@/types";
import { ANNOTATION_STYLES } from "@/constants";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useEventListener } from "@/hooks/useEventListener";

export type TextSelectionToolbarState = {
  isVisible: boolean;
  left: number;
  top: number;
  text: string;
};

export const useWorkspaceTextSelection = (opts: {
  editorState: EditorState;
  editorStateRef: RefObject<EditorState>;
  onAddAnnotation: (annotation: Annotation) => void;
  onSelectControl: (id: string | null) => void;
}) => {
  const { editorState, editorStateRef, onAddAnnotation, onSelectControl } =
    opts;

  const createTextHighlightFromSelection = useCallback(
    (hookOpts?: { force?: boolean }) => {
      const state = editorStateRef.current;
      if (!state) return;
      if (state.mode !== "annotation") return;
      if (!hookOpts?.force && state.tool !== "draw_highlight") return;

      const sel = window.getSelection?.();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

      const selectedText = sel.toString().trim();
      if (!selectedText) {
        sel.removeAllRanges();
        return;
      }

      const range = sel.getRangeAt(0);
      const commonNode = range.commonAncestorContainer;
      const commonEl =
        commonNode instanceof Element
          ? commonNode
          : commonNode.parentElement || null;

      const pageEl = commonEl?.closest?.("[id^='page-']") as HTMLElement | null;
      const textLayerEl = commonEl?.closest?.(
        ".textLayer",
      ) as HTMLElement | null;

      // Only create highlights from the actual PDF text layer.
      if (!pageEl || !textLayerEl) return;

      textLayerEl.classList.remove("selecting");

      const rects = Array.from(range.getClientRects()).filter(
        (r) => r.width > 1 && r.height > 1,
      );
      if (rects.length === 0) {
        sel.removeAllRanges();
        return;
      }

      const pageId = pageEl.id;
      const pageIndexStr = pageId.replace(/^page-/, "");
      const pageIndex = Number.parseInt(pageIndexStr, 10);
      if (!Number.isFinite(pageIndex)) return;

      const scale = state.scale;
      const pageRect = pageEl.getBoundingClientRect();

      const uiRects = rects
        .map((r) => ({
          x: (r.left - pageRect.left) / scale,
          y: (r.top - pageRect.top) / scale,
          width: r.width / scale,
          height: r.height / scale,
        }))
        .filter((r) => r.width > 0.5 && r.height > 0.5);

      if (uiRects.length === 0) {
        sel.removeAllRanges();
        return;
      }

      const sorted = [...uiRects].sort((a, b) =>
        Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y,
      );

      const deduped: { x: number; y: number; width: number; height: number }[] =
        [];
      const isNearSame = (
        a: { x: number; y: number; width: number; height: number },
        b: { x: number; y: number; width: number; height: number },
      ) =>
        Math.abs(a.x - b.x) < 1 &&
        Math.abs(a.y - b.y) < 1 &&
        Math.abs(a.width - b.width) < 1 &&
        Math.abs(a.height - b.height) < 1;

      for (const r of sorted) {
        const exists = deduped.some((d) => isNearSame(d, r));
        if (!exists) deduped.push(r);
      }

      const merged: { x: number; y: number; width: number; height: number }[] =
        [];
      for (const r of deduped) {
        const last = merged[merged.length - 1];
        if (
          last &&
          Math.abs(last.y - r.y) < 2 &&
          Math.abs(last.height - r.height) < 2 &&
          r.x <= last.x + last.width + 2
        ) {
          const newX = Math.min(last.x, r.x);
          const newRight = Math.max(last.x + last.width, r.x + r.width);
          last.x = newX;
          last.width = newRight - newX;
          last.y = Math.min(last.y, r.y);
          last.height = Math.max(last.height, r.height);
        } else {
          merged.push({ ...r });
        }
      }

      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      for (const r of merged) {
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
      }

      if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
        sel.removeAllRanges();
        return;
      }

      onAddAnnotation({
        id: `highlight_${Date.now()}`,
        pageIndex,
        type: "highlight",
        rect: {
          x: minX,
          y: minY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
        },
        rects: merged,
        color: state.highlightStyle?.color || ANNOTATION_STYLES.highlight.color,
        opacity:
          state.highlightStyle?.opacity ?? ANNOTATION_STYLES.highlight.opacity,
      });

      // Text highlight should not be auto-selected; keep the tool ready for continuous highlighting.
      onSelectControl(null);

      sel.removeAllRanges();
    },
    [editorStateRef, onAddAnnotation, onSelectControl],
  );

  const [textSelectionToolbar, setTextSelectionToolbar] =
    useState<TextSelectionToolbarState>({
      isVisible: false,
      left: 0,
      top: 0,
      text: "",
    });

  const [textSelectingPages, setTextSelectingPages] = useState<
    Record<number, true>
  >({});

  useAppEvent("workspace:textSelectingChange", (payload) => {
    setTextSelectingPages((prev) => {
      const has = !!prev[payload.pageIndex];
      if (has === payload.isSelecting) return prev;
      const next = { ...prev };
      if (payload.isSelecting) next[payload.pageIndex] = true;
      else delete next[payload.pageIndex];
      return next;
    });
  });

  const textSelectionVirtualRef = useRef<any>({
    getBoundingClientRect: () => new DOMRect(),
    contextElement: document.body,
  });

  const isTextSelectingRef = useRef(false);

  const updateTextSelectionToolbar = useCallback(() => {
    if (editorState.tool !== "select" || editorState.mode !== "annotation") {
      setTextSelectionToolbar((prev) =>
        prev.isVisible ? { ...prev, isVisible: false } : prev,
      );
      return;
    }

    // Only show after selection ends (mouse/pointer released)
    if (isTextSelectingRef.current) {
      setTextSelectionToolbar((prev) =>
        prev.isVisible ? { ...prev, isVisible: false } : prev,
      );
      return;
    }

    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setTextSelectionToolbar((prev) =>
        prev.isVisible ? { ...prev, isVisible: false } : prev,
      );
      return;
    }

    const selectedText = sel.toString().trim();
    if (!selectedText) {
      setTextSelectionToolbar((prev) =>
        prev.isVisible ? { ...prev, isVisible: false } : prev,
      );
      return;
    }

    const range = sel.getRangeAt(0);
    const getClosestTextLayer = (node: Node | null) => {
      if (!node) return null;
      const el = node instanceof Element ? node : node.parentElement;
      return el?.closest?.(".textLayer") ?? null;
    };

    const startTextLayer = getClosestTextLayer(range.startContainer);
    const endTextLayer = getClosestTextLayer(range.endContainer);
    const isFromTextLayer = !!startTextLayer || !!endTextLayer;
    if (!isFromTextLayer) {
      setTextSelectionToolbar((prev) =>
        prev.isVisible ? { ...prev, isVisible: false } : prev,
      );
      return;
    }

    const clientRects = Array.from(range.getClientRects()).filter(
      (r) => r.width >= 2 && r.height >= 2,
    );
    const isBackward = (() => {
      const anchorNode = sel.anchorNode;
      const focusNode = sel.focusNode;
      if (!anchorNode || !focusNode) return false;
      const a = document.createRange();
      a.setStart(anchorNode, sel.anchorOffset);
      a.collapse(true);
      const f = document.createRange();
      f.setStart(focusNode, sel.focusOffset);
      f.collapse(true);
      return a.compareBoundaryPoints(Range.START_TO_START, f) === 1;
    })();

    const rect =
      (clientRects.length > 0
        ? isBackward
          ? clientRects[0]
          : clientRects[clientRects.length - 1]
        : null) ?? range.getBoundingClientRect();
    if (!rect || rect.width < 2 || rect.height < 2) {
      setTextSelectionToolbar((prev) =>
        prev.isVisible ? { ...prev, isVisible: false } : prev,
      );
      return;
    }

    let left = rect.left + rect.width / 2;
    let top = rect.top;

    // Clamp to viewport so it doesn't render off-screen.
    const pad = 12;
    left = Math.max(pad, Math.min(window.innerWidth - pad, left));
    top = Math.max(pad, top);

    textSelectionVirtualRef.current = {
      getBoundingClientRect: () => new DOMRect(left, top, 1, 1),
      contextElement: document.body,
    };

    setTextSelectionToolbar({ isVisible: true, left, top, text: selectedText });
  }, [editorState.mode, editorState.tool]);

  useEffect(() => {
    if (!textSelectionToolbar.isVisible) return;
    requestAnimationFrame(() => {
      updateTextSelectionToolbar();
    });
  }, [
    editorState.scale,
    textSelectionToolbar.isVisible,
    updateTextSelectionToolbar,
  ]);

  useEffect(() => {
    updateTextSelectionToolbar();
  }, [updateTextSelectionToolbar, editorStateRef]);

  useEventListener(
    typeof document !== "undefined" ? document : null,
    "selectionchange",
    () => updateTextSelectionToolbar(),
  );

  useEventListener(
    typeof window !== "undefined" ? window : null,
    "resize",
    () => updateTextSelectionToolbar(),
  );

  useEventListener<PointerEvent>(
    typeof document !== "undefined" ? document : null,
    "pointerdown",
    (e) => {
      const state = editorStateRef.current;
      if (!state) return;
      if (state.tool !== "select") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(".textLayer")) {
        isTextSelectingRef.current = true;
        setTextSelectionToolbar((prev) =>
          prev.isVisible ? { ...prev, isVisible: false } : prev,
        );
      }
    },
    true,
  );

  useEventListener(
    typeof document !== "undefined" ? document : null,
    "pointerup",
    () => {
      if (!isTextSelectingRef.current) return;
      // Defer one frame so the browser has time to finalize the selection range.
      // Keep isTextSelectingRef=true during this frame to prevent selectionchange from
      // prematurely showing a toolbar with a transient (0,0) bounding rect.
      requestAnimationFrame(() => {
        isTextSelectingRef.current = false;
        updateTextSelectionToolbar();
      });
    },
    true,
  );

  useEventListener(
    typeof document !== "undefined" ? document : null,
    "pointercancel",
    () => {
      if (!isTextSelectingRef.current) return;
      isTextSelectingRef.current = false;
      setTextSelectionToolbar((prev) =>
        prev.isVisible ? { ...prev, isVisible: false } : prev,
      );
    },
    true,
  );

  useEffect(() => {
    if (
      editorState.mode !== "annotation" ||
      editorState.tool !== "draw_highlight"
    ) {
      return;
    }

    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

    // Only auto-convert selections that come from the PDF.js text layer.
    const range = sel.getRangeAt(0);
    const commonNode = range.commonAncestorContainer;
    const commonEl =
      commonNode instanceof Element
        ? commonNode
        : commonNode.parentElement || null;
    const isFromTextLayer = !!commonEl?.closest?.(".textLayer");
    if (!isFromTextLayer) return;

    createTextHighlightFromSelection();
  }, [editorState.mode, editorState.tool, createTextHighlightFromSelection]);

  return {
    createTextHighlightFromSelection,
    textSelectionToolbar,
    setTextSelectionToolbar,
    textSelectionVirtualRef,
    textSelectingPages,
    updateTextSelectionToolbar,
  };
};
