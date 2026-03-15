import { useCallback } from "react";
import type { WorkspaceEditorState } from "@/types";

type Point = { x: number; y: number };

const dist2 = (p: Point, v: Point) => {
  return (p.x - v.x) * (p.x - v.x) + (p.y - v.y) * (p.y - v.y);
};

const distToSegmentSquared = (p: Point, v: Point, w: Point) => {
  const l2 = dist2(v, w);
  if (l2 === 0) return dist2(p, v);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist2(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
};

export const useWorkspaceEraser = (opts: {
  editorState: Pick<WorkspaceEditorState, "annotations" | "scale">;
  onDeleteAnnotation: (id: string) => void;
}) => {
  const checkEraserCollision = useCallback(
    (x: number, y: number, pageIndex: number) => {
      // Threshold in unscaled units.
      // If we want 10px visual radius on screen, in unscaled coords it's 10 / scale.
      const VISUAL_RADIUS = 10;
      const threshold = VISUAL_RADIUS / opts.editorState.scale;
      const thresholdSq = threshold * threshold;

      // Check annotations on this page
      const pageAnnotations = opts.editorState.annotations.filter(
        (a) => a.pageIndex === pageIndex,
      );

      for (const annot of pageAnnotations) {
        // Ink Detection
        if (annot.type === "ink") {
          const strokes =
            annot.strokes && annot.strokes.length > 0
              ? annot.strokes
              : annot.points
                ? [annot.points]
                : [];

          for (const stroke of strokes) {
            for (let i = 0; i < stroke.length - 1; i++) {
              const p1 = stroke[i];
              const p2 = stroke[i + 1];
              const distSq = distToSegmentSquared({ x, y }, p1, p2);
              if (distSq < thresholdSq) {
                opts.onDeleteAnnotation(annot.id);
                return; // Delete one at a time per move event to avoid conflicts
              }
            }
          }
        }
        // Box Detection (Highlight/Comment)
        else if (annot.rect) {
          const { x: rx, y: ry, width: rw, height: rh } = annot.rect;
          // Simple box overlap check with eraser point (expanded by radius)
          if (
            x >= rx - threshold &&
            x <= rx + rw + threshold &&
            y >= ry - threshold &&
            y <= ry + rh + threshold
          ) {
            opts.onDeleteAnnotation(annot.id);
            return;
          }
        }
      }
    },
    [
      opts.editorState.annotations,
      opts.editorState.scale,
      opts.onDeleteAnnotation,
    ],
  );

  return { checkEraserCollision };
};
