import React from "react";
import { FormField, Annotation, PDFMetadata } from "@/types";
import { DocumentPropertiesPanel } from "./DocumentPropertiesPanel";
import { ControlPropertiesPanel } from "./ControlPropertiesPanel";
import { useEditorStore } from "@/store/useEditorStore";
import { useShallow } from "zustand/react/shallow";
import { selectPropertiesPanelState } from "@/store/selectors";
import {
  canPerformPdfPermissionOperation,
  canModifyPdfContents,
  mergePdfPermissionDirtyScopes,
} from "@/lib/pdfPermissions";
import { usePdfPermissionUi } from "@/hooks/usePdfPermissionUi";

// --- Main Container Component ---
interface PropertiesPanelProps {
  selectedControl: FormField | Annotation | null;
  activeTab: string;
  metadata: PDFMetadata;
  filename: string;
  onChange: (data: FormField | Annotation) => void;
  onMetadataChange: (updates: Partial<PDFMetadata>) => void;
  onFilenameChange: (name: string) => void;
  onDelete: (id: string) => void;
  onClose?: () => void;
  onCollapse?: () => void;
  isOpen: boolean;
  onOpen: () => void;
  isFloating: boolean;
  onTriggerHistorySave: () => void;
  width: number;
  onResize: (width: number) => void;
}

export const PropertiesPanel = React.memo<PropertiesPanelProps>(
  ({
    selectedControl,
    activeTab,
    metadata,
    filename,
    onChange,
    onMetadataChange,
    onFilenameChange,
    onDelete,
    onClose,
    onCollapse,
    isOpen,
    onOpen,
    isFloating,
    onTriggerHistorySave,
    width,
    onResize,
  }) => {
    const {
      exportPassword,
      pdfOpenPassword,
      documentPermissions,
      sourceDocumentPermissions,
      pdfOwnerUnlocked,
      preservePdfOwnerRestrictionsOnSave,
      unlockPdfOwnerRestrictions,
      setEditorState,
    } = useEditorStore(useShallow(selectPropertiesPanelState));
    const permissionUi = usePdfPermissionUi(documentPermissions);

    if (activeTab === "properties" && selectedControl) {
      const handleControlChange = (
        updates: Partial<FormField | Annotation>,
      ) => {
        onChange({ ...selectedControl, ...updates } as FormField | Annotation);
      };
      const handleClose = onClose ?? onCollapse ?? (() => {});
      const handleCollapse = onCollapse ?? handleClose;
      const isField = "name" in selectedControl && "style" in selectedControl;
      const canEditControl = canPerformPdfPermissionOperation(
        isField ? "edit_form_structure" : "edit_annotation",
        documentPermissions,
      );

      return (
        <ControlPropertiesPanel
          data={selectedControl}
          onChange={handleControlChange}
          onDelete={() => onDelete(selectedControl.id)}
          onClose={handleClose}
          isOpen={isOpen}
          onOpen={onOpen}
          onCollapse={handleCollapse}
          isFloating={isFloating}
          onTriggerHistorySave={onTriggerHistorySave}
          canEdit={canEditControl}
          restrictedTitle={permissionUi.restrictedTitle}
          width={width}
          onResize={onResize}
        />
      );
    }

    const handleDocumentClose = onCollapse ?? onClose;

    return (
      <DocumentPropertiesPanel
        metadata={metadata}
        onMetadataChange={onMetadataChange}
        filename={filename}
        onFilenameChange={onFilenameChange}
        exportPassword={exportPassword}
        pdfOpenPassword={pdfOpenPassword}
        pdfOwnerUnlocked={pdfOwnerUnlocked}
        preservePdfOwnerRestrictionsOnSave={preservePdfOwnerRestrictionsOnSave}
        onExportPasswordChange={(password) => {
          if (!canModifyPdfContents(documentPermissions)) {
            return;
          }
          setEditorState((prev) => ({
            exportPassword: password,
            isDirty: true,
            dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
              prev.dirtyPermissionScopes,
              { modifyContents: true },
            ),
          }));
        }}
        onOwnerPasswordUnlock={async (password) => {
          const result = await unlockPdfOwnerRestrictions(password);
          return result.ok && result.unlocked;
        }}
        sourceDocumentPermissions={sourceDocumentPermissions}
        onPreserveOwnerRestrictionsOnSaveChange={(preserve) => {
          setEditorState((prev) => ({
            preservePdfOwnerRestrictionsOnSave: preserve,
            isDirty: true,
            dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
              prev.dirtyPermissionScopes,
              { modifyContents: true },
            ),
          }));
        }}
        canModifyContents={canModifyPdfContents(documentPermissions)}
        isOpen={isOpen}
        onOpen={onOpen}
        onCollapse={onCollapse}
        onClose={handleDocumentClose}
        isFloating={isFloating}
        onTriggerHistorySave={onTriggerHistorySave}
        width={width}
        onResize={onResize}
      />
    );
  },
);
