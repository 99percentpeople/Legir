import React from "react";

import { useEditorDocumentIdentityRuntime } from "@/app/editorRuntime";
import { AiChatPanel } from "@/components/properties-panel/AiChatPanel";
import { useAiChatController } from "@/hooks/useAiChatController";
import {
  selectAiChatEditorState,
  selectAiChatReactiveState,
} from "@/store/selectors";
import { createAiChatSnapshotReader } from "@/hooks/useAiChatController/editorSnapshot";
import { useEditorStore } from "@/store/useEditorStore";
import type { PDFSearchResult } from "@/types";
import { useShallow } from "zustand/react/shallow";

const readEditorSnapshot = () =>
  selectAiChatEditorState(useEditorStore.getState());

function EditorAiRightPanel({
  aiScopeId,
  onSearchHighlightsChange,
  isFloating,
  isOpen,
  onOpen,
  width,
  onResize,
  onCollapse,
}: {
  aiScopeId?: string;
  onSearchHighlightsChange: (
    highlights: Map<number, PDFSearchResult[]>,
  ) => void;
  isFloating: boolean;
  isOpen: boolean;
  onOpen: () => void;
  width: number;
  onResize: (width: number) => void;
  onCollapse: () => void;
}) {
  const editorState = useEditorStore(useShallow(selectAiChatReactiveState));
  const documentIdentity = useEditorDocumentIdentityRuntime();
  // A new activation must get a new token, even when A -> B -> A restores the
  // same PDF bytes/worker. Old async readers also expire when this panel unmounts.
  const activation = React.useMemo(
    () => ({}),
    [documentIdentity, aiScopeId, editorState.pdfBytes],
  );
  const activeActivationRef = React.useRef<object | null>(null);
  React.useLayoutEffect(() => {
    activeActivationRef.current = activation;
    return () => {
      activeActivationRef.current = null;
    };
  }, [activation]);
  const getEditorSnapshot = React.useMemo(
    () =>
      createAiChatSnapshotReader(
        readEditorSnapshot,
        editorState.pdfBytes,
        () => activeActivationRef.current === activation,
      ),
    [activation, editorState.pdfBytes],
  );
  const { workerService } = documentIdentity;
  const aiChat = useAiChatController(
    editorState,
    aiScopeId,
    workerService ?? undefined,
    getEditorSnapshot,
  );

  React.useEffect(() => {
    onSearchHighlightsChange(aiChat.highlightedSearchResultsByPage);
  }, [aiChat.highlightedSearchResultsByPage, onSearchHighlightsChange]);

  return (
    <AiChatPanel
      isFloating={isFloating}
      isOpen={isOpen}
      onOpen={onOpen}
      width={width}
      onResize={onResize}
      onCollapse={onCollapse}
      aiChat={aiChat}
    />
  );
}

export default React.memo(EditorAiRightPanel);
