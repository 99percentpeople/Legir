import React from "react";

import { PropertiesPanel } from "@/components/properties-panel/PropertiesPanel";
import { getMovedAnnotationUpdates } from "@/lib/controlMovement";
import {
  canModifyPdfContents,
  mergePdfPermissionDirtyScopes,
} from "@/lib/pdfPermissions";
import { selectEditorRightPanelState } from "@/store/selectors";
import { useEditorStore } from "@/store/useEditorStore";
import type { Annotation, FormField, PDFSearchResult } from "@/types";
import { useShallow } from "zustand/react/shallow";

const EditorAiRightPanel = React.lazy(() => import("./EditorAiRightPanel"));
const EditorPageTranslateRightPanel = React.lazy(
  () => import("./EditorPageTranslateRightPanel"),
);

export function EditorRightPanel({
  aiScopeId,
  onAiSearchHighlightsChange,
}: {
  aiScopeId?: string;
  onAiSearchHighlightsChange: (
    highlights: Map<number, PDFSearchResult[]>,
  ) => void;
}) {
  const state = useEditorStore(useShallow(selectEditorRightPanelState));
  const isDocumentReady = state.documentLoadState === "ready";

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
  const hasMountedAiRef = React.useRef(false);
  if (state.rightPanelTab === "ai_chat") {
    hasMountedAiRef.current = true;
  }

  const openPanel = () => {
    state.setUiState((prev) => {
      if (prev.isPanelFloating) {
        return { isRightPanelOpen: true, isSidebarOpen: false };
      }
      return { isRightPanelOpen: true };
    });
  };

  const handlePropertiesChange = (updates: Partial<FormField | Annotation>) => {
    if (!isDocumentReady) return;
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
    if (!isDocumentReady) return;
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

  const aiPanel = hasMountedAiRef.current ? (
    <div className={state.rightPanelTab === "ai_chat" ? "contents" : "hidden"}>
      <React.Suspense fallback={null}>
        <EditorAiRightPanel
          aiScopeId={aiScopeId}
          onSearchHighlightsChange={onAiSearchHighlightsChange}
          isFloating={state.isPanelFloating}
          isOpen={state.isRightPanelOpen && state.rightPanelTab === "ai_chat"}
          onOpen={openPanel}
          width={state.rightPanelWidth}
          onResize={(width) => state.setUiState({ rightPanelWidth: width })}
          onCollapse={() => state.setUiState({ isRightPanelOpen: false })}
        />
      </React.Suspense>
    </div>
  ) : null;

  if (state.rightPanelTab === "page_translate") {
    return (
      <>
        {aiPanel}
        <React.Suspense fallback={null}>
          <EditorPageTranslateRightPanel />
        </React.Suspense>
      </>
    );
  }

  return (
    <>
      {aiPanel}
      {state.rightPanelTab !== "ai_chat" && (
        <PropertiesPanel
          selectedControl={selectedControl}
          activeTab={
            state.rightPanelTab === "properties" ? "properties" : "document"
          }
          metadata={state.metadata}
          filename={state.filename}
          onChange={handlePropertiesChange}
          onMetadataChange={(updates) => {
            if (isDocumentReady) state.updateMetadata(updates);
          }}
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
      )}
    </>
  );
}
