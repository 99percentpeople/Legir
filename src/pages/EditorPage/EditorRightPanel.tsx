import React from "react";

import { selectRightPanelShellState } from "@/store/selectors";
import { EditorPropertiesRightPanel } from "./EditorPropertiesRightPanel";
import { EditorRightPanelSkeleton } from "./components/EditorRightPanelSkeleton";
import { useEditorStore } from "@/store/useEditorStore";
import type { PDFSearchResult } from "@/types";
import { useShallow } from "zustand/react/shallow";
import {
  EditorAiRightPanel,
  EditorPageTranslateRightPanel,
} from "./rightPanelModules";

export function EditorRightPanel({
  aiScopeId,
  onAiSearchHighlightsChange,
}: {
  aiScopeId?: string;
  onAiSearchHighlightsChange: (
    highlights: Map<number, PDFSearchResult[]>,
  ) => void;
}) {
  const state = useEditorStore(useShallow(selectRightPanelShellState));
  const canRenderRightPanel =
    state.mode === "form" ||
    state.mode === "annotation" ||
    state.hasSelectedControl;
  const hasMountedAiRef = React.useRef(false);
  if (state.rightPanelTab === "ai_chat") hasMountedAiRef.current = true;

  const openPanel = React.useCallback(
    () => state.openRightPanel(),
    [state.openRightPanel],
  );
  const resizePanel = React.useCallback(
    (width: number) => state.setUiState({ rightPanelWidth: width }),
    [state.setUiState],
  );

  if (!canRenderRightPanel) return null;

  // EditorRightPanel itself is lazy-loaded by EditorPage, while AI and page
  // translation are split into a second lazy layer. Keep the same shell-sized
  // fallback across both layers so resolving the outer chunk cannot create a
  // blank frame before the active branch finishes loading.
  const loadingFallback = state.isRightPanelOpen ? (
    <EditorRightPanelSkeleton
      isFloating={state.isPanelFloating}
      width={state.rightPanelWidth}
    />
  ) : null;

  const aiPanel = hasMountedAiRef.current ? (
    <div className={state.rightPanelTab === "ai_chat" ? "contents" : "hidden"}>
      <React.Suspense fallback={loadingFallback}>
        <EditorAiRightPanel
          aiScopeId={aiScopeId}
          onSearchHighlightsChange={onAiSearchHighlightsChange}
          isFloating={state.isPanelFloating}
          isOpen={state.isRightPanelOpen && state.rightPanelTab === "ai_chat"}
          onOpen={openPanel}
          width={state.rightPanelWidth}
          onResize={resizePanel}
          onCollapse={state.closeRightPanel}
        />
      </React.Suspense>
    </div>
  ) : null;

  if (state.rightPanelTab === "page_translate") {
    return (
      <>
        {aiPanel}
        <React.Suspense fallback={loadingFallback}>
          <EditorPageTranslateRightPanel />
        </React.Suspense>
      </>
    );
  }

  return (
    <>
      {aiPanel}
      {state.rightPanelTab !== "ai_chat" && (
        <EditorPropertiesRightPanel
          activeTab={
            state.rightPanelTab === "properties" ? "properties" : "document"
          }
          onCollapse={state.closeRightPanel}
          isOpen={state.isRightPanelOpen}
          onOpen={openPanel}
          isFloating={state.isPanelFloating}
          width={state.rightPanelWidth}
          onResize={resizePanel}
        />
      )}
    </>
  );
}
