import React from "react";

import { useLanguage } from "@/components/language-provider";
import { PageTranslatePanel } from "@/components/properties-panel/PageTranslatePanel";
import { usePageTranslation } from "@/hooks/usePageTranslation";
import { selectPageTranslateRightPanelState } from "@/store/selectors";
import { useEditorStore } from "@/store/useEditorStore";
import type { EditorUiState } from "@/types";
import { useShallow } from "zustand/react/shallow";

export default function EditorPageTranslateRightPanel() {
  const state = useEditorStore(useShallow(selectPageTranslateRightPanelState));
  const { effectiveLanguage } = useLanguage();
  const isDocumentReady = state.documentLoadState === "ready";
  const {
    isPageTranslating,
    pageTranslateStatus,
    cancelPageTranslate,
    handleStartPageTranslate,
    handlePreviewParagraphs,
    handleUnmergeSelectedParagraphs,
  } = usePageTranslation();

  const openPanel = () => {
    state.setUiState((prev) => {
      if (prev.isPanelFloating) {
        return { isRightPanelOpen: true, isSidebarOpen: false };
      }
      return { isRightPanelOpen: true };
    });
  };

  const updatePageTranslateOptions = (
    patch: Partial<EditorUiState["pageTranslateOptions"]>,
  ) => {
    state.setUiState((prev) => ({
      pageTranslateOptions: {
        ...prev.pageTranslateOptions,
        ...patch,
      },
    }));

    if (typeof patch.flattenFreetext === "boolean") {
      state.setAllFreetextFlatten(patch.flattenFreetext);
    }
  };

  return (
    <PageTranslatePanel
      isFloating={state.isPanelFloating}
      isOpen={state.isRightPanelOpen}
      onOpen={openPanel}
      width={state.rightPanelWidth}
      onResize={(width) => state.setUiState({ rightPanelWidth: width })}
      onCollapse={() => state.setUiState({ isRightPanelOpen: false })}
      totalPages={state.pagesLength}
      isProcessing={isPageTranslating || !isDocumentReady}
      processingStatus={pageTranslateStatus}
      documentPermissions={state.documentPermissions}
      initialTranslateOption={state.translateOption}
      initialTargetLanguage={state.translateTargetLanguage || effectiveLanguage}
      options={state.pageTranslateOptions}
      onOptionsChange={updatePageTranslateOptions}
      paragraphCandidatesCount={state.pageTranslateParagraphCandidates.length}
      selectedParagraphCount={state.pageTranslateSelectedParagraphIds.length}
      onPreviewParagraphs={(options) => {
        if (!isDocumentReady) return;
        void handlePreviewParagraphs(options);
      }}
      onClearParagraphs={state.clearPageTranslateParagraphCandidates}
      onMergeSelectedParagraphs={state.mergeSelectedPageTranslateParagraphs}
      onUnmergeSelectedParagraphs={() => {
        void handleUnmergeSelectedParagraphs();
      }}
      onToggleExcludeSelectedParagraphs={
        state.toggleExcludeSelectedPageTranslateParagraphs
      }
      onDeleteSelectedParagraphs={state.deleteSelectedPageTranslateParagraphs}
      onStart={(options) => {
        if (!isDocumentReady) return;
        void handleStartPageTranslate(options);
      }}
      onCancel={cancelPageTranslate}
    />
  );
}
