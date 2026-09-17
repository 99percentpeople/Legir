import React from "react";

import { useEditorDocumentIdentityRuntime } from "@/app/editorRuntime";
import { AiChatPanel } from "@/components/properties-panel/AiChatPanel";
import { useAiChatController } from "@/hooks/useAiChatController";
import { selectAiChatEditorState } from "@/store/selectors";
import { useEditorStore } from "@/store/useEditorStore";
import type { PDFSearchResult } from "@/types";
import { useShallow } from "zustand/react/shallow";

export default function EditorAiRightPanel({
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
  const editorState = useEditorStore(useShallow(selectAiChatEditorState));
  const { workerService } = useEditorDocumentIdentityRuntime();
  const aiChat = useAiChatController(
    editorState,
    aiScopeId,
    workerService ?? undefined,
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
