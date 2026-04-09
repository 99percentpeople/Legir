import { useCallback } from "react";
import type { WorkspaceEditorState } from "@/types";

export type SnapLine = {
  type: "vertical" | "horizontal";
  pos: number;
  start: number;
  end: number;
};

type SnapRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const useWorkspaceSnapping = (opts: {
  editorState: Pick<WorkspaceEditorState, "fields" | "mode" | "options">;
}) => {
  const applySnapping = useCallback(
    (
      rect: SnapRect,
      pageIndex: number,
      excludeId: string | null,
      threshold: number,
    ) => {
      // (Snapping logic reuse from original - simplified for brevity here as it is unchanged logic)
      // Only run in form mode
      if (opts.editorState.mode !== "form")
        return { x: rect.x, y: rect.y, guides: [] as SnapLine[] };

      const { snapToBorders, snapToCenter, snapToEqualDistances } =
        opts.editorState.options.snappingOptions;
      const guides: SnapLine[] = [];
      let { x, y } = rect;
      const otherFields = opts.editorState.fields.filter(
        (f) => f.pageIndex === pageIndex && f.id !== excludeId,
      );

      let bestDx = Infinity;
      let snapX: number | null = null;
      let guideX: number | null = null;
      const checkSnap = (diff: number, newPos: number, guidePos: number) => {
        if (Math.abs(diff) < Math.abs(bestDx) && Math.abs(diff) < threshold) {
          bestDx = diff;
          snapX = newPos;
          guideX = guidePos;
        }
      };

      otherFields.forEach((f) => {
        if (snapToBorders) {
          checkSnap(f.rect.x - x, f.rect.x, f.rect.x);
          checkSnap(
            f.rect.x + f.rect.width - x,
            f.rect.x + f.rect.width,
            f.rect.x + f.rect.width,
          );
          checkSnap(
            f.rect.x - (x + rect.width),
            f.rect.x - rect.width,
            f.rect.x,
          );
          checkSnap(
            f.rect.x + f.rect.width - (x + rect.width),
            f.rect.x + f.rect.width - rect.width,
            f.rect.x + f.rect.width,
          );
        }
        if (snapToCenter) {
          const theirCenter = f.rect.x + f.rect.width / 2;
          const myCenter = x + rect.width / 2;
          checkSnap(
            theirCenter - myCenter,
            theirCenter - rect.width / 2,
            theirCenter,
          );
        }
      });

      // Equal Distances (Horizontal)
      if (snapToEqualDistances) {
        const sameRow = otherFields
          .filter(
            (f) =>
              Math.max(rect.y, f.rect.y) <
              Math.min(rect.y + rect.height, f.rect.y + f.rect.height),
          )
          .sort((a, b) => a.rect.x - b.rect.x);

        for (let i = 0; i < sameRow.length - 1; i++) {
          const A = sameRow[i].rect;
          const B = sameRow[i + 1].rect;
          const gap = B.x - (A.x + A.width);

          // 1. Snap to Right: A ... B ... [Me]
          const targetRight = B.x + B.width + gap;
          checkSnap(targetRight - x, targetRight, targetRight);

          // 2. Snap to Left: [Me] ... A ... B
          const targetLeft = A.x - gap - rect.width;
          checkSnap(targetLeft - x, targetLeft, targetLeft);

          // 3. Snap Between: A ... [Me] ... B
          const targetMid = (A.x + A.width + B.x - rect.width) / 2;
          checkSnap(targetMid - x, targetMid, targetMid);
        }
      }

      if (snapX !== null && guideX !== null) {
        x = snapX;
        guides.push({
          type: "vertical",
          pos: guideX as number,
          start: 0,
          end: 2000,
        });
      }

      let bestDy = Infinity;
      let snapY: number | null = null;
      let guideY: number | null = null;
      const checkSnapY = (diff: number, newPos: number, guidePos: number) => {
        if (Math.abs(diff) < Math.abs(bestDy) && Math.abs(diff) < threshold) {
          bestDy = diff;
          snapY = newPos;
          guideY = guidePos;
        }
      };
      otherFields.forEach((f) => {
        if (snapToBorders) {
          checkSnapY(f.rect.y - y, f.rect.y, f.rect.y);
          checkSnapY(
            f.rect.y + f.rect.height - y,
            f.rect.y + f.rect.height,
            f.rect.y + f.rect.height,
          );
          checkSnapY(
            f.rect.y - (y + rect.height),
            f.rect.y - rect.height,
            f.rect.y,
          );
          checkSnapY(
            f.rect.y + f.rect.height - (y + rect.height),
            f.rect.y + f.rect.height - rect.height,
            f.rect.y + f.rect.height,
          );
        }
        if (snapToCenter) {
          const theirCenter = f.rect.y + f.rect.height / 2;
          const myCenter = y + rect.height / 2;
          checkSnapY(
            theirCenter - myCenter,
            theirCenter - rect.height / 2,
            theirCenter,
          );
        }
      });

      // Equal Distances (Vertical)
      if (snapToEqualDistances) {
        const sameCol = otherFields
          .filter(
            (f) =>
              Math.max(rect.x, f.rect.x) <
              Math.min(rect.x + rect.width, f.rect.x + f.rect.width),
          )
          .sort((a, b) => a.rect.y - b.rect.y);

        for (let i = 0; i < sameCol.length - 1; i++) {
          const A = sameCol[i].rect;
          const B = sameCol[i + 1].rect;
          const gap = B.y - (A.y + A.height);

          // 1. Snap to Bottom: A
          //                    B
          //                   [Me]
          const targetBottom = B.y + B.height + gap;
          checkSnapY(targetBottom - y, targetBottom, targetBottom);

          // 2. Snap to Top:   [Me]
          //                    A
          //                    B
          const targetTop = A.y - gap - rect.height;
          checkSnapY(targetTop - y, targetTop, targetTop);

          // 3. Snap Between:   A
          //                   [Me]
          //                    B
          const targetMid = (A.y + A.height + B.y - rect.height) / 2;
          checkSnapY(targetMid - y, targetMid, targetMid);
        }
      }

      if (snapY !== null && guideY !== null) {
        y = snapY;
        guides.push({
          type: "horizontal",
          pos: guideY as number,
          start: 0,
          end: 2000,
        });
      }

      return { x, y, guides };
    },
    [
      opts.editorState.fields,
      opts.editorState.mode,
      opts.editorState.options.snappingOptions,
    ],
  );

  return { applySnapping };
};
