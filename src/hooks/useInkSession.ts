import { useEffect, useRef, useCallback, type MutableRefObject } from "react";
import { Annotation, EditorState, Tool } from "@/types";

type Point = { x: number; y: number };

interface UseInkSessionParams {
  editorState: Pick<EditorState, "tool" | "penStyle">;
  editorStateRef: MutableRefObject<EditorState>;
  onAddAnnotation: (annotation: Annotation) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  onSelectControl: (id: string | null) => void;
  onCancelInProgressStroke: () => void;
}

export const useInkSession = ({
  editorState,
  editorStateRef,
  onAddAnnotation,
  onUpdateAnnotation,
  onSelectControl,
  onCancelInProgressStroke,
}: UseInkSessionParams) => {
  const inkSessionIdRef = useRef<string | null>(null);
  const inkSessionPageIndexRef = useRef<number | null>(null);
  const inkSessionStrokesRef = useRef<Point[][]>([]);
  const prevToolRef = useRef<Tool>(editorState.tool);

  const resetSession = useCallback(() => {
    inkSessionIdRef.current = null;
    inkSessionPageIndexRef.current = null;
    inkSessionStrokesRef.current = [];
  }, []);

  useEffect(() => {
    const prev = prevToolRef.current;
    const next = editorState.tool;

    if (prev === "draw_ink" && next !== "draw_ink") {
      resetSession();
      onCancelInProgressStroke();
    }

    prevToolRef.current = next;
  }, [editorState.tool, onCancelInProgressStroke, resetSession]);

  const appendStroke = useCallback(
    (pageIndex: number, stroke: Point[]) => {
      if (stroke.length <= 1) return;

      const sessionPageIndex = inkSessionPageIndexRef.current;

      if (
        inkSessionIdRef.current &&
        sessionPageIndex !== null &&
        sessionPageIndex === pageIndex
      ) {
        inkSessionStrokesRef.current = [
          ...inkSessionStrokesRef.current,
          stroke,
        ];
        onUpdateAnnotation(inkSessionIdRef.current, {
          strokes: inkSessionStrokesRef.current,
        });
        return;
      }

      const id = `ink_${Date.now()}`;
      const prevSelectedId = editorStateRef.current.selectedId;

      inkSessionIdRef.current = id;
      inkSessionPageIndexRef.current = pageIndex;
      inkSessionStrokesRef.current = [stroke];

      onAddAnnotation({
        id,
        pageIndex,
        type: "ink",
        strokes: [stroke],
        color: editorState.penStyle.color,
        thickness: editorState.penStyle.thickness,
        opacity: editorState.penStyle.opacity,
      });

      onSelectControl(prevSelectedId);
    },
    [
      editorState.penStyle.color,
      editorState.penStyle.opacity,
      editorState.penStyle.thickness,
      editorStateRef,
      onAddAnnotation,
      onSelectControl,
      onUpdateAnnotation,
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
