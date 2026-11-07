import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useEditorViewApi } from "@/store/useEditorView";
import { useEditorTabIsActive } from "@/app/editorTabs/context";
import { canPerformPdfPermissionOperation } from "@legir/pdf-model/pdfPermissions";
import { FieldType, type Annotation, type FormField } from "@/types";

import type { SelectionPreview } from "../lib/controlSelectionPreview";

type Point = { x: number; y: number };

/** Group movement is only a preview until pointer-up; cancellation never edits the PDF. */
export function useControlMultiSelection(
  getPoint: (x: number, y: number, pageIndex: number) => Point,
  isPanModeActive: boolean,
) {
  const editor = useEditorViewApi();
  const active = useEditorTabIsActive();
  const [preview, setPreview] = useState<SelectionPreview | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!active || isPanModeActive) cleanupRef.current?.();
    return () => cleanupRef.current?.();
  }, [active, isPanModeActive, editor]);

  const onPointerDownCapture = useCallback(
    (event: ReactPointerEvent, control: FormField | Annotation) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-app-keyboard-handle]")
      )
        return false;
      const state = editor.getState();
      const isField = state.fields.some((item) => item.id === control.id);
      if (
        !active ||
        isPanModeActive ||
        state.tool !== "select" ||
        event.button !== 0 ||
        state.mode !== (isField ? "form" : "annotation")
      )
        return false;
      const toggle = event.ctrlKey || event.metaKey;
      const group =
        state.selectedControlIds.length > 1 &&
        state.selectedControlIds.includes(control.id);
      if (!toggle && !group) return false;
      event.stopPropagation();
      // Keep touch scrolling and pinch native. Desktop modifier selection owns clicks.
      if (event.pointerType === "touch" && !toggle) return true;
      event.preventDefault();
      cleanupRef.current?.();
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
      )?.blur();
      window.getSelection()?.removeAllRanges();
      const ids = new Set(group ? state.selectedControlIds : [control.id]);
      const canDrag =
        canPerformPdfPermissionOperation(
          isField
            ? "edit_form_structure"
            : toggle
              ? "create_annotation"
              : "edit_annotation",
          state.documentPermissions,
        ) &&
        !state.fields.some(
          (field) =>
            ids.has(field.id) &&
            field.type === FieldType.SIGNATURE &&
            field.signature?.present,
        );
      const pointerId = event.pointerId;
      const start = getPoint(event.clientX, event.clientY, control.pageIndex);
      const startClient = { x: event.clientX, y: event.clientY };
      let lastClient = startClient;
      let scrollFrame: number | null = null;
      let delta = { x: 0, y: 0 };
      let moved = false;
      const updatePreview = () => {
        const point = getPoint(lastClient.x, lastClient.y, control.pageIndex);
        delta = { x: point.x - start.x, y: point.y - start.y };
        if (canDrag) setPreview({ ...delta, ids, duplicate: toggle });
      };
      const scroll = () => {
        // Scrolling changes PDF coordinates even when the pointer stays still.
        // A click must still cross the pointer threshold before it becomes a drag.
        if (!moved || !canDrag || scrollFrame !== null) return;
        scrollFrame = requestAnimationFrame(() => {
          scrollFrame = null;
          updatePreview();
        });
      };
      const move = (next: PointerEvent) => {
        if (next.pointerId !== pointerId) return;
        next.preventDefault();
        next.stopPropagation();
        lastClient = { x: next.clientX, y: next.clientY };
        if (
          !moved &&
          Math.hypot(
            next.clientX - startClient.x,
            next.clientY - startClient.y,
          ) < 4
        )
          return;
        moved = true;
        updatePreview();
      };
      const finish = (next: PointerEvent) => {
        if (next.pointerId !== pointerId) return;
        move(next);
        cleanup();
        if (moved) {
          if (!canDrag) return;
          if (toggle)
            editor.getState().duplicateControls([...ids], delta.x, delta.y);
          else
            editor.getState().translateSelectedControls(delta.x, delta.y, true);
        } else
          editor
            .getState()
            .selectControl(control.id, toggle ? "toggle" : "replace");
      };
      const cancelPointer = (next: PointerEvent) => {
        if (next.pointerId === pointerId) cleanup();
      };
      const cancelKey = (next: KeyboardEvent) => {
        if (next.key !== "Escape") return;
        next.preventDefault();
        next.stopPropagation();
        cleanup();
      };
      const cleanup = () => {
        if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
        scrollFrame = null;
        window.removeEventListener("scroll", scroll, true);
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", finish, true);
        window.removeEventListener("pointercancel", cancelPointer, true);
        window.removeEventListener("blur", cleanup);
        window.removeEventListener("keydown", cancelKey, true);
        unsubscribe();
        cleanupRef.current = null;
        setPreview(null);
      };
      const unsubscribe = editor.subscribe((next) => {
        if (
          next.selectedControlIds !== state.selectedControlIds ||
          next.fields !== state.fields ||
          next.annotations !== state.annotations ||
          next.pdfBytes !== state.pdfBytes ||
          next.tool !== state.tool ||
          next.mode !== state.mode ||
          next.scale !== state.scale ||
          next.viewRotation !== state.viewRotation ||
          next.documentPermissions !== state.documentPermissions ||
          next.activeDialog
        )
          cleanup();
      });
      cleanupRef.current = cleanup;
      window.addEventListener("scroll", scroll, true);
      window.addEventListener("pointermove", move, {
        capture: true,
        passive: false,
      });
      window.addEventListener("pointerup", finish, true);
      window.addEventListener("pointercancel", cancelPointer, true);
      window.addEventListener("blur", cleanup);
      window.addEventListener("keydown", cancelKey, true);
      return true;
    },
    [active, editor, getPoint, isPanModeActive],
  );
  return { preview, onPointerDownCapture };
}
