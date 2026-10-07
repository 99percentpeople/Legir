import React from "react";
import { useShallow } from "zustand/react/shallow";
import { useEditorView } from "@/store/useEditorView";
import {
  selectAiChatEditorState,
  selectAiChatReactiveState,
} from "@/store/selectors";
import { useAiChatController } from "@/hooks/useAiChatController";
import type { AiWorkspace } from "@/services/ai/chat/workspace";

const readEditorSnapshot = () =>
  selectAiChatEditorState(useEditorView.getState());
function GlobalAiControllerHost({
  workspace,
  onChange,
}: {
  workspace: AiWorkspace;
  onChange: (controller: ReturnType<typeof useAiChatController>) => void;
}) {
  const state = useEditorView(useShallow(selectAiChatReactiveState));
  const documentId = workspace.getActiveDocumentId();
  const worker = documentId
    ? workspace.getDocument(documentId)?.workerService
    : undefined;
  const controller = useAiChatController(
    state,
    "workspace",
    worker,
    readEditorSnapshot,
    workspace,
  );
  React.useLayoutEffect(() => onChange(controller), [controller, onChange]);
  return null;
}

// Publishing a controller updates the provider. That update must not feed back
// into the host; its own store subscriptions and hook state drive updates.
export default React.memo(GlobalAiControllerHost);
