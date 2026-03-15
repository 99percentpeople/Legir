import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Annotation, WorkspaceEditorState } from "@/types";
import { ANNOTATION_STYLES } from "@/constants";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useEventListener } from "@/hooks/useEventListener";
import {
  getPdfSearchSelectionOffsets,
  getPdfSearchTextSlice,
} from "../lib/pdfSearchHighlights";

export type TextSelectionToolbarState = {
  isVisible: boolean;
  left: number;
  top: number;
  text: string;
  selection: {
    pageIndex: number;
    startOffset: number;
    endOffset: number;
    exactText: string;
    rect: { x: number; y: number; width: number; height: number };
  } | null;
};

type PdfSpaceRect = { x: number; y: number; width: number; height: number };

const dedupeAndMergePdfRects = (rects: PdfSpaceRect[]) => {
  const sorted = [...rects].sort((a, b) =>
    Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y,
  );

  const deduped: PdfSpaceRect[] = [];
  const isNearSame = (a: PdfSpaceRect, b: PdfSpaceRect) =>
    Math.abs(a.x - b.x) < 1 &&
    Math.abs(a.y - b.y) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1;

  for (const rect of sorted) {
    const exists = deduped.some((item) => isNearSame(item, rect));
    if (!exists) deduped.push(rect);
  }

  const merged: PdfSpaceRect[] = [];
  for (const rect of deduped) {
    const last = merged[merged.length - 1];
    if (
      last &&
      Math.abs(last.y - rect.y) < 2 &&
      Math.abs(last.height - rect.height) < 2 &&
      rect.x <= last.x + last.width + 2
    ) {
      const newX = Math.min(last.x, rect.x);
      const newRight = Math.max(last.x + last.width, rect.x + rect.width);
      last.x = newX;
      last.width = newRight - newX;
      last.y = Math.min(last.y, rect.y);
      last.height = Math.max(last.height, rect.height);
    } else {
      merged.push({ ...rect });
    }
  }

  return merged;
};

const getPdfSelectionRects = (
  range: Range,
  pageEl: HTMLElement,
  scale: number,
) => {
  const pageRect = pageEl.getBoundingClientRect();
  const uiRects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 1 && rect.height > 1)
    .map((rect) => ({
      x: (rect.left - pageRect.left) / scale,
      y: (rect.top - pageRect.top) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    }))
    .filter((rect) => rect.width > 0.5 && rect.height > 0.5);

  if (uiRects.length === 0) return null;

  const rects = dedupeAndMergePdfRects(uiRects);
  if (rects.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  return {
    rects,
    rect: {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    },
  };
};

export const useWorkspaceTextSelection = (opts: {
  editorState: WorkspaceEditorState;
  editorStateRef: RefObject<WorkspaceEditorState>;
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

      const selectionGeometry = getPdfSelectionRects(
        range,
        pageEl,
        state.scale,
      );
      if (!selectionGeometry) {
        sel.removeAllRanges();
        return;
      }

      onAddAnnotation({
        id: `highlight_${Date.now()}`,
        pageIndex,
        type: "highlight",
        rect: selectionGeometry.rect,
        rects: selectionGeometry.rects,
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
      selection: null,
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

  const textSelectionVirtualRef = useRef<{
    getBoundingClientRect: () => DOMRect;
    contextElement: Element | null;
  }>({
    getBoundingClientRect: () => new DOMRect(),
    contextElement: document.body,
  });

  const isTextSelectingRef = useRef(false);
  const isHandleDraggingRef = useRef(false);
  const preferredHandleKindRef = useRef<"start" | "end" | null>(null);

  useAppEvent(
    "workspace:textSelectionHandleDraggingChange",
    ({ dragging, handleKind }) => {
      isHandleDraggingRef.current = dragging;
      if (handleKind) preferredHandleKindRef.current = handleKind;
      if (dragging) {
        setTextSelectionToolbar((prev) =>
          prev.isVisible ? { ...prev, isVisible: false } : prev,
        );
      } else {
        requestAnimationFrame(() => {
          updateTextSelectionToolbar();
        });
      }
    },
    { replayLast: true },
  );

  const updateTextSelectionToolbar = useCallback(() => {
    if (editorState.tool !== "select" || editorState.mode !== "annotation") {
      setTextSelectionToolbar((prev) =>
        prev.isVisible ? { ...prev, isVisible: false } : prev,
      );
      return;
    }

    if (isHandleDraggingRef.current) {
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

    const sharedTextLayer =
      startTextLayer && endTextLayer && startTextLayer === endTextLayer
        ? (startTextLayer as HTMLElement)
        : null;
    const pageElement = sharedTextLayer?.closest?.(
      "[id^='page-']",
    ) as HTMLElement | null;
    const pageIndex = Number.parseInt(
      pageElement?.id.replace(/^page-/, "") ?? "",
      10,
    );
    const offsets = sharedTextLayer
      ? getPdfSearchSelectionOffsets(sharedTextLayer, sel)
      : null;
    const selectionGeometry =
      pageElement && Number.isFinite(pageIndex)
        ? getPdfSelectionRects(range, pageElement, editorState.scale)
        : null;
    const selection =
      Number.isFinite(pageIndex) &&
      offsets &&
      selectionGeometry &&
      sharedTextLayer
        ? {
            pageIndex,
            startOffset: offsets.startOffset,
            endOffset: offsets.endOffset,
            exactText: getPdfSearchTextSlice(
              sharedTextLayer,
              offsets.startOffset,
              offsets.endOffset,
            ),
            rect: selectionGeometry.rect,
          }
        : null;

    const rawClientRects = Array.from(range.getClientRects()).filter(
      (r) => r.width >= 1 && r.height >= 2,
    );
    const clientRects = (() => {
      if (rawClientRects.length <= 1) return rawClientRects;
      const heights = [...rawClientRects]
        .map((r) => r.height)
        .sort((a, b) => a - b);
      const median = heights[Math.floor(heights.length / 2)] ?? 0;
      const maxHeight = Math.max(8, median * 3);
      const filtered = rawClientRects.filter((r) => r.height <= maxHeight);
      return filtered.length ? filtered : rawClientRects;
    })();

    const lineRects = (() => {
      if (clientRects.length === 0) return [] as DOMRect[];
      const sorted = [...clientRects].sort((a, b) =>
        Math.abs(a.top - b.top) < 2 ? a.left - b.left : a.top - b.top,
      );

      const lines: Array<{
        left: number;
        right: number;
        top: number;
        bottom: number;
        height: number;
      }> = [];

      for (const r of sorted) {
        const last = lines[lines.length - 1];
        const midY = r.top + r.height / 2;
        const isSameLine =
          !!last &&
          midY >= last.top - last.height * 0.6 &&
          midY <= last.bottom + last.height * 0.6;

        if (!last || !isSameLine) {
          lines.push({
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            height: r.height,
          });
          continue;
        }

        last.left = Math.min(last.left, r.left);
        last.right = Math.max(last.right, r.right);
        last.top = Math.min(last.top, r.top);
        last.bottom = Math.max(last.bottom, r.bottom);
        last.height = Math.max(last.height, r.height, last.bottom - last.top);
      }

      return lines.map(
        (l) =>
          new DOMRect(
            l.left,
            l.top,
            Math.max(1, l.right - l.left),
            l.bottom - l.top,
          ),
      );
    })();
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

    const preferred = preferredHandleKindRef.current;
    const lineIndex =
      preferred === "start"
        ? 0
        : preferred === "end"
          ? lineRects.length - 1
          : isBackward
            ? 0
            : lineRects.length - 1;

    const getCaretRect = (node: Node, offset: number) => {
      try {
        const r = document.createRange();
        r.setStart(node, offset);
        r.collapse(true);
        const caretRect = r.getClientRects()[0] ?? r.getBoundingClientRect();
        if (caretRect && caretRect.height > 0) return caretRect;
      } catch {}

      const el = node instanceof Element ? node : node.parentElement;
      const span = el?.closest?.("span[role='presentation']") as
        | HTMLSpanElement
        | null
        | undefined;
      if (!span) return null;
      const rect = span.getBoundingClientRect();
      if (rect.width + rect.height === 0) return null;
      return rect;
    };

    const preferStart = preferred === "start" || (!preferred && isBackward);
    const caretNode = preferStart ? range.startContainer : range.endContainer;
    const caretOffset = preferStart ? range.startOffset : range.endOffset;
    const isEndOfContentNode = (node: Node) => {
      const el = node instanceof Element ? node : node.parentElement;
      return !!el?.closest?.(".endOfContent");
    };
    const caretRect = isEndOfContentNode(caretNode)
      ? null
      : getCaretRect(caretNode, caretOffset);

    const lineRectForCaret = caretRect
      ? lineRects.reduce<DOMRect | null>((closest, candidate) => {
          if (!candidate || candidate.height <= 0) return closest;
          const caretCenter = caretRect.top + caretRect.height / 2;
          const candidateCenter = candidate.top + candidate.height / 2;
          const distance = Math.abs(candidateCenter - caretCenter);
          if (!closest) return candidate;
          const closestCenter = closest.top + closest.height / 2;
          return distance < Math.abs(closestCenter - caretCenter)
            ? candidate
            : closest;
        }, null)
      : null;

    const rect =
      lineRectForCaret ??
      lineRects[lineIndex] ??
      caretRect ??
      range.getBoundingClientRect();

    if (!rect || rect.height < 2) {
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

    setTextSelectionToolbar({
      isVisible: true,
      left,
      top,
      text: selectedText,
      selection,
    });
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
        preferredHandleKindRef.current = null;
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
