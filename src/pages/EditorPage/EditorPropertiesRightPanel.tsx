import React from "react";
import { useShallow } from "zustand/react/shallow";

import { PropertiesPanel } from "@/components/properties-panel/PropertiesPanel";
import { getMovedAnnotationUpdates } from "@/lib/controlMovement";
import {
  canModifyPdfContents,
  mergePdfPermissionDirtyScopes,
} from "@/lib/pdfPermissions";
import { selectPropertiesRightPanelState } from "@/store/selectors";
import { useEditorStore } from "@/store/useEditorStore";
import type { Annotation, FormField } from "@/types";

type Props = Pick<
  React.ComponentProps<typeof PropertiesPanel>,
  | "activeTab"
  | "isOpen"
  | "isFloating"
  | "width"
  | "onOpen"
  | "onResize"
  | "onCollapse"
>;

// This branch is mounted only for properties/document tabs. Unrelated control
// updates retain the selected object's identity and do not wake this connector.
export function EditorPropertiesRightPanel(props: Props) {
  const state = useEditorStore(useShallow(selectPropertiesRightPanelState));
  const isDocumentReady = state.documentLoadState === "ready";

  const handlePropertiesChange = (updates: Partial<FormField | Annotation>) => {
    const selected = state.selectedControl;
    if (!isDocumentReady || !selected) return;
    if (state.isSelectedField) {
      state.updateField(selected.id, updates as Partial<FormField>);
      return;
    }
    const annotation = selected as Annotation;
    const nextRect = updates.rect;
    const currentRect = annotation.rect;
    if (
      currentRect &&
      nextRect &&
      nextRect.width === currentRect.width &&
      nextRect.height === currentRect.height &&
      (nextRect.x !== currentRect.x || nextRect.y !== currentRect.y)
    ) {
      state.updateAnnotation(selected.id, {
        ...updates,
        ...getMovedAnnotationUpdates(
          annotation,
          nextRect.x - currentRect.x,
          nextRect.y - currentRect.y,
        ),
      } as Partial<Annotation>);
      return;
    }
    state.updateAnnotation(selected.id, updates as Partial<Annotation>);
  };

  const handleFilenameChange = (filename: string) => {
    if (!isDocumentReady || !canModifyPdfContents(state.documentPermissions))
      return;
    state.setState((prev) =>
      prev.filename === filename
        ? prev
        : {
            filename,
            isDirty: true,
            dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
              prev.dirtyPermissionScopes,
              { modifyContents: true },
            ),
          },
    );
  };

  return (
    <PropertiesPanel
      {...props}
      selectedControl={state.selectedControl}
      metadata={state.metadata}
      filename={state.filename}
      onChange={handlePropertiesChange}
      onMetadataChange={(updates) => {
        if (isDocumentReady) state.updateMetadata(updates);
      }}
      onFilenameChange={handleFilenameChange}
      onDelete={state.deleteSelection}
      onClose={() => state.selectControl(null)}
      onTriggerHistorySave={state.saveCheckpoint}
    />
  );
}
