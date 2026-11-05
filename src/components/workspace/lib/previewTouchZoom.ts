import type { WorkspaceEditorState } from "@/types";
import { canPanViewportFromTarget } from "@/hooks/useViewportTouchGestures";

export function getPreviewDoubleTapTarget(
  target: EventTarget | null,
  state: Pick<WorkspaceEditorState, "mode" | "tool" | "selectedId">,
) {
  if (
    state.mode !== "annotation" ||
    (state.tool !== "select" && state.tool !== "pan") ||
    state.selectedId ||
    !(target instanceof Element)
  )
    return null;
  const page = target.closest<HTMLElement>("[data-workspace-page]");
  // Empty text-layer space is still the page; actual text keeps its native
  // double-tap selection behavior.
  const hitTarget = target.classList.contains("textLayer")
    ? target.parentElement
    : target;
  if (!page || !canPanViewportFromTarget(hitTarget, page)) return null;
  const selection = page.ownerDocument.getSelection();
  if (selection && !selection.isCollapsed) return null;
  return page;
}
