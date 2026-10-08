import { useCallback } from "react";
import {
  useEditorEventBus,
  useEditorTabIsActive,
} from "@/app/editorTabs/context";
import { useEditorViewApi } from "@/store/useEditorView";
import type { Tool } from "@/types";

// The event is synchronous and scoped to this document. Workspace owns drafts;
// the controller owns tool/selection state, never the completed annotations.
export function useEditorToolActions(defaultTool: Tool) {
  const events = useEditorEventBus();
  const store = useEditorViewApi();
  const isActive = useEditorTabIsActive();
  const cancelToolDraft = useCallback(() => {
    if (!isActive) return false;
    const request = { draftsOnly: true, handled: false };
    events.emit("workspace:cancelToolInteraction", request);
    return request.handled;
  }, [events, isActive]);
  const exitTool = useCallback(() => {
    if (!isActive) return;
    events.emit("workspace:cancelToolInteraction", {
      draftsOnly: false,
      handled: false,
    });
    const state = store.getState();
    // Releasing Space after an explicit exit must not restore the old tool.
    state.setKeys({ ...state.keys, space: false });
    state.selectControl(null);
    state.setTool(defaultTool);
  }, [defaultTool, events, isActive, store]);
  const changeTool = useCallback(
    (tool: Tool) => {
      if (!isActive) return;
      if (store.getState().tool !== tool) {
        events.emit("workspace:cancelToolInteraction", {
          draftsOnly: false,
          handled: false,
        });
      }
      store.getState().setTool(tool);
    },
    [events, isActive, store],
  );
  return { changeTool, exitTool, cancelToolDraft };
}
