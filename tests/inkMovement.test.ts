import { expect, it } from "vitest";
import { getMovedAnnotationUpdates } from "@/lib/controlMovement";
import {
  getInkRenderPath,
  getInkSvgPath,
  prepareInkAnnotationForStore,
} from "@/lib/inkGeometry";
import { createTestEditorStore } from "./helpers/editorStore";
import type { Annotation } from "@/types";

const ink = () => {
  const points = [
    { x: 10, y: 20 },
    { x: 40, y: 60 },
    { x: 90, y: 30 },
  ];
  return prepareInkAnnotationForStore({
    id: "ink",
    type: "ink",
    pageIndex: 0,
    thickness: 2,
    points,
    strokes: [
      points,
      [
        { x: 30, y: 40 },
        { x: 70, y: 90 },
      ],
    ],
  });
};

it("reuses drawing commands while translating canonical strokes, including undo/redo", () => {
  const original = ink();
  const originalPath = getInkRenderPath(original);
  const store = createTestEditorStore({
    annotations: [original],
    selectedId: original.id,
  });
  try {
    store.getState().saveCheckpoint();
    for (let i = 0; i < 10; i++) {
      const current = store.getState().annotations[0];
      store.getState().updateAnnotation(current.id, {
        ...getMovedAnnotationUpdates(current, 2, -1),
        pageIndex: 1,
      });
    }
    const moved = store.getState().annotations[0];
    expect(moved.points).toBe(moved.strokes![0]);
    expect(moved.points![0]).toEqual({ x: 30, y: 10 });
    expect(original.points![0]).toEqual({ x: 10, y: 20 });
    expect(moved.rect).toEqual({
      ...original.rect!,
      x: original.rect!.x + 20,
      y: original.rect!.y - 10,
    });
    expect(getInkRenderPath(moved)).toEqual({
      d: originalPath.d,
      dx: 20,
      dy: -10,
    });
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().annotations[0]).toBe(original);
    expect(getInkRenderPath(store.getState().annotations[0])).toEqual(
      originalPath,
    );
    store.getState().redo();
    expect(store.getState().annotations[0]).toBe(moved);
    // Transfer/reopen loses only a derived WeakMap entry, never stroke geometry.
    const restored = JSON.parse(JSON.stringify(moved)) as Annotation;
    expect(getInkRenderPath(restored)).toEqual({
      d: getInkSvgPath(restored.strokes!),
      dx: 0,
      dy: 0,
    });
    expect(restored.points).toEqual(moved.points);
  } finally {
    store.dispose();
  }
});

it("invalidates the path on an actual stroke edit and preserves untouched imported appearances", () => {
  const original = { ...ink(), svgPath: "M 10 20 C 20 40 50 60 90 30" };
  expect(getInkRenderPath(prepareInkAnnotationForStore(original)).d).toBe(
    original.svgPath,
  );
  const moved = prepareInkAnnotationForStore(
    { ...original, ...getMovedAnnotationUpdates(original, 5, 6) },
    { recomputeRect: true, recomputeSvgPath: true },
  );
  expect(getInkRenderPath(moved)).toEqual({
    d: getInkSvgPath(original.strokes!),
    dx: 5,
    dy: 6,
  });
  const edited = prepareInkAnnotationForStore(
    {
      ...moved,
      strokes: [
        [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      ],
    },
    { recomputeRect: true, recomputeSvgPath: true },
  );
  expect(getInkRenderPath(edited)).toEqual({ d: "M 1 2 L 3 4", dx: 0, dy: 0 });
});
