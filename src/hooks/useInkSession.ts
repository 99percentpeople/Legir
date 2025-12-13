import { useEffect, useRef, useCallback, type MutableRefObject } from "react";
import { Annotation, EditorState, Tool } from "@/types";

type Point = { x: number; y: number };

interface UseInkSessionParams {
  editorState: Pick<EditorState, "tool" | "penStyle" | "highlightStyle">;
  editorStateRef: MutableRefObject<EditorState>;
  onAddAnnotation: (annotation: Annotation) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  onSelectControl: (id: string | null) => void;
  onCancelInProgressStroke: () => void;
  onTriggerHistorySave: () => void;
}

export const useInkSession = ({
  editorState,
  editorStateRef,
  onAddAnnotation,
  onUpdateAnnotation,
  onSelectControl,
  onCancelInProgressStroke,
  onTriggerHistorySave,
}: UseInkSessionParams) => {
  const inkSessionIdRef = useRef<string | null>(null);
  const inkSessionPageIndexRef = useRef<number | null>(null);
  const inkSessionStrokesRef = useRef<Point[][]>([]);
  const inkSessionToolRef = useRef<Tool | null>(null);
  const prevToolRef = useRef<Tool>(editorState.tool);

  const resetSession = useCallback(() => {
    inkSessionIdRef.current = null;
    inkSessionPageIndexRef.current = null;
    inkSessionStrokesRef.current = [];
    inkSessionToolRef.current = null;
  }, []);

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

  const appendStroke = useCallback(
    (pageIndex: number, stroke: Point[]) => {
      if (stroke.length <= 1) return;

      const activeTool = editorStateRef.current.tool;
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
        const currentAnnotations = editorStateRef.current.annotations;
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
          onUpdateAnnotation(sessionId, {
            strokes: inkSessionStrokesRef.current,
          });
          return;
        }
      }

      const id = `ink_${Date.now()}`;
      const prevSelectedId = editorStateRef.current.selectedId;

      inkSessionIdRef.current = id;
      inkSessionPageIndexRef.current = pageIndex;
      inkSessionStrokesRef.current = [stroke];
      inkSessionToolRef.current = activeTool;

      onAddAnnotation({
        id,
        pageIndex,
        type: "ink",
        strokes: [stroke],
        color: style.color,
        thickness: style.thickness,
        opacity: style.opacity,
        intent: isHighlight ? "InkHighlight" : undefined,
      });

      onSelectControl(prevSelectedId);
    },
    [
      editorState.highlightStyle,
      editorState.penStyle,
      editorStateRef,
      onAddAnnotation,
      onSelectControl,
      onTriggerHistorySave,
      onUpdateAnnotation,
      resetSession,
    ],
  );

  return {
    appendStroke,
    resetSession,
    inkSessionIdRef,
    inkSessionPageIndexRef,
    inkSessionStrokesRef,
  };
};
