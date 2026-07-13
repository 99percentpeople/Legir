import React from "react";

import { AiChatPanel } from "@/components/properties-panel/AiChatPanel";
import { PageTranslatePanel } from "@/components/properties-panel/PageTranslatePanel";
import { PropertiesPanel } from "@/components/properties-panel/PropertiesPanel";
import { useLanguage } from "@/components/language-provider";
import { usePageTranslation } from "@/hooks/usePageTranslation";
import { getMovedAnnotationUpdates } from "@/lib/controlMovement";
import {
  canModifyPdfContents,
  mergePdfPermissionDirtyScopes,
} from "@/lib/pdfPermissions";
import { selectEditorRightPanelState } from "@/store/selectors";
import { useEditorStore } from "@/store/useEditorStore";
import type { Annotation, EditorUiState, FormField } from "@/types";
import { useShallow } from "zustand/react/shallow";

interface EditorRightPanelProps {
  aiChat: ReturnType<
    typeof import("@/hooks/useAiChatController").useAiChatController
  >;
}

export function EditorRightPanel({ aiChat }: EditorRightPanelProps) {
  const state = useEditorStore(useShallow(selectEditorRightPanelState));
  const { effectiveLanguage } = useLanguage();
  const {
    isPageTranslating,
    pageTranslateStatus,
    cancelPageTranslate,
    handleStartPageTranslate,
    handlePreviewParagraphs,
    handleUnmergeSelectedParagraphs,
  } = usePageTranslation();

  const selectedField = state.selectedId
    ? (state.fields.find((field) => field.id === state.selectedId) ?? null)
    : null;
  const selectedAnnotation = state.selectedId
    ? (state.annotations.find(
        (annotation) => annotation.id === state.selectedId,
      ) ?? null)
    : null;
  const selectedControl = selectedField ?? selectedAnnotation;
  const canRenderRightPanel =
    state.mode === "form" || state.mode === "annotation" || !!selectedControl;

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

  const handlePropertiesChange = (updates: Partial<FormField | Annotation>) => {
    const selectedId = state.selectedId;
    if (!selectedId) return;

    if (state.fields.some((field) => field.id === selectedId)) {
      state.updateField(selectedId, updates as Partial<FormField>);
      return;
    }

    const annotation = state.annotations.find((item) => item.id === selectedId);
    if (!annotation) return;

    const nextRect = updates.rect;
    const currentRect = annotation.rect;
    if (
      currentRect &&
      nextRect &&
      nextRect.width === currentRect.width &&
      nextRect.height === currentRect.height &&
      (nextRect.x !== currentRect.x || nextRect.y !== currentRect.y)
    ) {
      state.updateAnnotation(selectedId, {
        ...updates,
        ...getMovedAnnotationUpdates(
          annotation,
          nextRect.x - currentRect.x,
          nextRect.y - currentRect.y,
        ),
      } as Partial<Annotation>);
      return;
    }

    state.updateAnnotation(selectedId, updates as Partial<Annotation>);
  };

  const handleFilenameChange = (name: string) => {
    if (!canModifyPdfContents(state.documentPermissions)) return;
    state.setState((prev) => ({
      filename: name,
      isDirty: true,
      dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
        prev.dirtyPermissionScopes,
        { modifyContents: true },
      ),
    }));
  };

  if (!canRenderRightPanel) return null;

  if (state.rightPanelTab === "ai_chat") {
    return (
      <AiChatPanel
        isFloating={state.isPanelFloating}
        isOpen={state.isRightPanelOpen}
        onOpen={openPanel}
        width={state.rightPanelWidth}
        onResize={(width) => state.setUiState({ rightPanelWidth: width })}
        onCollapse={() => state.setUiState({ isRightPanelOpen: false })}
        aiChat={aiChat}
      />
    );
  }

  if (state.rightPanelTab === "page_translate") {
    return (
      <PageTranslatePanel
        isFloating={state.isPanelFloating}
        isOpen={state.isRightPanelOpen}
        onOpen={openPanel}
        width={state.rightPanelWidth}
        onResize={(width) => state.setUiState({ rightPanelWidth: width })}
        onCollapse={() => state.setUiState({ isRightPanelOpen: false })}
        totalPages={state.pagesLength}
        isProcessing={isPageTranslating}
        processingStatus={pageTranslateStatus}
        documentPermissions={state.documentPermissions}
        initialTranslateOption={state.translateOption}
        initialTargetLanguage={
          state.translateTargetLanguage || effectiveLanguage
        }
        options={state.pageTranslateOptions}
        onOptionsChange={updatePageTranslateOptions}
        paragraphCandidatesCount={state.pageTranslateParagraphCandidates.length}
        selectedParagraphCount={state.pageTranslateSelectedParagraphIds.length}
        onPreviewParagraphs={(options) => {
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
          void handleStartPageTranslate(options);
        }}
        onCancel={cancelPageTranslate}
      />
    );
  }

  return (
    <PropertiesPanel
      selectedControl={selectedControl}
      activeTab={
        state.rightPanelTab === "properties" ? "properties" : "document"
      }
      metadata={state.metadata}
      filename={state.filename}
      onChange={handlePropertiesChange}
      onMetadataChange={state.updateMetadata}
      onFilenameChange={handleFilenameChange}
      onDelete={state.deleteSelection}
      onClose={() => {
        state.setUiState({ rightPanelTab: "document" });
        state.selectControl(null);
      }}
      onCollapse={() => state.setUiState({ isRightPanelOpen: false })}
      isOpen={state.isRightPanelOpen}
      onOpen={openPanel}
      isFloating={state.isPanelFloating}
      onTriggerHistorySave={state.saveCheckpoint}
      width={state.rightPanelWidth}
      onResize={(width) => state.setUiState({ rightPanelWidth: width })}
    />
  );
}
