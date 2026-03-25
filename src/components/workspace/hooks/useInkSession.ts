import { useEffect, useRef, useCallback, type RefObject } from "react";
import { prepareInkAnnotationForStore } from "@/lib/inkGeometry";
import { INK_SESSION_CHUNK_IDLE_DELAY_MS } from "@/constants";
import { Annotation, EditorState, Tool, WorkspaceEditorState } from "@/types";

type Point = { x: number; y: number };

interface UseInkSessionParams {
  editorState: Pick<EditorState, "tool" | "penStyle" | "highlightStyle">;
  editorStateRef: RefObject<WorkspaceEditorState>;
  onAddAnnotation: (
    annotation: Annotation,
    opts?: { select?: boolean },
  ) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  onCancelInProgressStroke: () => void;
  onTriggerHistorySave: () => void;
  pointSpacingPx?: number;
  chunkIdleDelayMs?: number;
}

export const useInkSession = ({
  editorState,
  editorStateRef,
  onAddAnnotation,
  onUpdateAnnotation,
  onCancelInProgressStroke,
  onTriggerHistorySave,
  pointSpacingPx = 4,
  chunkIdleDelayMs = INK_SESSION_CHUNK_IDLE_DELAY_MS,
}: UseInkSessionParams) => {
  const inkSessionIdRef = useRef<string | null>(null);
  const inkSessionPageIndexRef = useRef<number | null>(null);
  const inkSessionStrokesRef = useRef<Point[][]>([]);
  const inkSessionToolRef = useRef<Tool | null>(null);
  const sessionChunkTimeoutRef = useRef<number | null>(null);
  const prevToolRef = useRef<Tool>(editorState.tool);

  const commitEditorStateRef = useCallback(
    (updater: (state: WorkspaceEditorState) => WorkspaceEditorState) => {
      const state = editorStateRef.current;
      if (!state) return;
      editorStateRef.current = updater(state);
    },
    [editorStateRef],
  );

  const clearSessionChunkTimeout = useCallback(() => {
    if (typeof window === "undefined") return;
    if (sessionChunkTimeoutRef.current === null) return;
    window.clearTimeout(sessionChunkTimeoutRef.current);
    sessionChunkTimeoutRef.current = null;
  }, []);

  const resetSession = useCallback(() => {
    clearSessionChunkTimeout();
    inkSessionIdRef.current = null;
    inkSessionPageIndexRef.current = null;
    inkSessionStrokesRef.current = [];
    inkSessionToolRef.current = null;
  }, [clearSessionChunkTimeout]);

  const scheduleSessionChunkTimeout = useCallback(() => {
    clearSessionChunkTimeout();
    if (typeof window === "undefined") return;
    sessionChunkTimeoutRef.current = window.setTimeout(() => {
      sessionChunkTimeoutRef.current = null;
      inkSessionIdRef.current = null;
      inkSessionPageIndexRef.current = null;
      inkSessionStrokesRef.current = [];
      inkSessionToolRef.current = null;
    }, chunkIdleDelayMs);
  }, [chunkIdleDelayMs, clearSessionChunkTimeout]);

  useEffect(() => {
    const prev = prevToolRef.current;
    const next = editorState.tool;

    const isInkFamily = (t: Tool) => t === "draw_ink" || t === "draw_highlight";

    if (isInkFamily(prev) && !isInkFamily(next)) {
      resetSession();
      onCancelInProgressStroke();
    } else if (isInkFamily(prev) && isInkFamily(next) && prev !== next) {
      resetSession();
      onCancelInProgressStroke();
    }

    prevToolRef.current = next;
  }, [editorState.tool, onCancelInProgressStroke, resetSession]);

  useEffect(() => {
    return () => {
      clearSessionChunkTimeout();
    };
  }, [clearSessionChunkTimeout]);

  const getMinPointDistancePdf = useCallback(() => {
    const desiredScreenPx = pointSpacingPx;
    const scale = editorStateRef.current?.scale ?? 1;

    // Convert desired visual spacing (CSS pixels) -> PDF-space distance.
    // ScreenDistancePx ~= PdfDistance * scale
    // => PdfDistance = ScreenDistancePx / scale
    const safeScale = Math.max(0.0001, scale);
    const raw = desiredScreenPx / safeScale;

    // Clamp to avoid too many points when zoomed in, or too few points when zoomed out.
    const minPdf = 0.5;
    const maxPdf = 24;
    return Math.max(minPdf, Math.min(maxPdf, raw));
  }, [editorStateRef, pointSpacingPx]);

  const shouldAppendPoint = useCallback(
    (prev: Point | undefined, next: Point) => {
      if (!prev) return true;
      const minDist = getMinPointDistancePdf();
      const dist = Math.hypot(next.x - prev.x, next.y - prev.y);
      return dist >= minDist;
    },
    [getMinPointDistancePdf],
  );

  const appendStroke = useCallback(
    (pageIndex: number, stroke: Point[]) => {
      if (stroke.length <= 1) return;
      clearSessionChunkTimeout();

      const state = editorStateRef.current;
      if (!state) return;

      const activeTool = state.tool;
      const isHighlight = activeTool === "draw_highlight";

      const style = isHighlight
        ? editorState.highlightStyle || editorState.penStyle
        : editorState.penStyle;

      const sessionPageIndex = inkSessionPageIndexRef.current;

      const canContinueSession =
        inkSessionIdRef.current &&
        sessionPageIndex !== null &&
        sessionPageIndex === pageIndex &&
        inkSessionToolRef.current === activeTool;

      if (canContinueSession) {
        const sessionId = inkSessionIdRef.current;
        const currentAnnotations = state.annotations;
        const currentAnnot = currentAnnotations.find((a) => a.id === sessionId);

        // If user has undone the annotation (or it was deleted), the cached session id becomes stale.
        // Reset and fall through to create a new annotation.
        if (!currentAnnot || currentAnnot.type !== "ink") {
          resetSession();
        } else {
          // Sync with the current annotation strokes (important after undo/redo)
          const existingStrokes =
            currentAnnot.strokes && currentAnnot.strokes.length > 0
              ? currentAnnot.strokes
              : currentAnnot.points
                ? [currentAnnot.points]
                : [];

          // Save history per stroke so undo reverts the last stroke instead of the whole session.
          onTriggerHistorySave();

          inkSessionStrokesRef.current = [...existingStrokes, stroke];
          const nextAnnotation = prepareInkAnnotationForStore(
            {
              ...currentAnnot,
              strokes: inkSessionStrokesRef.current,
            },
            {
              recomputeRect: true,
              recomputeSvgPath: true,
            },
          );
          commitEditorStateRef((currentState) => ({
            ...currentState,
            annotations: currentState.annotations.map((annotation) =>
              annotation.id === sessionId ? nextAnnotation : annotation,
            ),
          }));
          onUpdateAnnotation(sessionId, {
            strokes: inkSessionStrokesRef.current,
          });
          scheduleSessionChunkTimeout();
          return;
        }
      }

      const id = `ink_${Date.now()}`;

      inkSessionIdRef.current = id;
      inkSessionPageIndexRef.current = pageIndex;
      inkSessionStrokesRef.current = [stroke];
      inkSessionToolRef.current = activeTool;

      const nextAnnotation = prepareInkAnnotationForStore(
        {
          id,
          pageIndex,
          type: "ink",
          strokes: [stroke],
          color: style.color,
          thickness: style.thickness,
          opacity: style.opacity,
          intent: isHighlight ? "InkHighlight" : undefined,
        },
        {
          recomputeRect: true,
          recomputeSvgPath: true,
        },
      );

      commitEditorStateRef((currentState) => ({
        ...currentState,
        annotations: [...currentState.annotations, nextAnnotation],
      }));
      onAddAnnotation(nextAnnotation, { select: false });
      scheduleSessionChunkTimeout();
    },
    [
      clearSessionChunkTimeout,
      commitEditorStateRef,
      scheduleSessionChunkTimeout,
      editorState.highlightStyle,
      editorState.penStyle,
      editorStateRef,
      onAddAnnotation,
      onTriggerHistorySave,
      onUpdateAnnotation,
      resetSession,
    ],
  );

  const beginStroke = useCallback(() => {
    clearSessionChunkTimeout();
  }, [clearSessionChunkTimeout]);

  return {
    beginStroke,
    appendStroke,
    resetSession,
    inkSessionIdRef,
    inkSessionPageIndexRef,
    inkSessionStrokesRef,
    getMinPointDistancePdf,
    shouldAppendPoint,
  };
};
