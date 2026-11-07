import React from "react";
import { PanelLayout } from "./PanelLayout";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/language-provider";
import { FormField, Annotation, PDFMetadata } from "@/types";
import { DocumentPropertiesPanel } from "./DocumentPropertiesPanel";
import { ControlPropertiesPanel } from "./ControlPropertiesPanel";
import { useEditorView } from "@/store/useEditorView";
import { useShallow } from "zustand/react/shallow";
import { selectPropertiesPanelState } from "@/store/selectors";
import {
  canPerformPdfPermissionOperation,
  canModifyPdfContents,
  mergePdfPermissionDirtyScopes,
} from "@legir/pdf-model/pdfPermissions";
import { usePdfPermissionUi } from "@/hooks/usePdfPermissionUi";

// --- Main Container Component ---
interface PropertiesPanelProps {
  selectedControl: FormField | Annotation | null;
  selectedControlCount?: number;
  hasSignedSelection?: boolean;
  activeTab: string;
  metadata: PDFMetadata;
  filename: string;
  onChange: (data: FormField | Annotation) => void;
  onMetadataChange: (updates: Partial<PDFMetadata>) => void;
  onFilenameChange: (name: string) => void;
  onDelete: (id: string) => void;
  onCollapse: () => void;
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
    selectedControlCount = 1,
    hasSignedSelection = false,
    activeTab,
    metadata,
    filename,
    onChange,
    onMetadataChange,
    onFilenameChange,
    onDelete,
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
      documentLoadState,
      documentPermissions,
      sourceDocumentPermissions,
      pdfOwnerUnlocked,
      preservePdfOwnerRestrictionsOnSave,
      unlockPdfOwnerRestrictions,
      setEditorState,
    } = useEditorView(useShallow(selectPropertiesPanelState));
    const { t } = useLanguage();
    const permissionUi = usePdfPermissionUi(documentPermissions);

    if (
      activeTab === "properties" &&
      selectedControl &&
      selectedControlCount > 1
    ) {
      const canDelete =
        !hasSignedSelection &&
        documentLoadState === "ready" &&
        canPerformPdfPermissionOperation(
          "name" in selectedControl
            ? "edit_form_structure"
            : "delete_annotation",
          documentPermissions,
        );
      return (
        <PanelLayout
          title={t("properties.multi_selected", {
            count: selectedControlCount,
          })}
          isFloating={isFloating}
          isOpen={isOpen}
          onOpen={onOpen}
          onClose={onCollapse}
          onCollapse={onCollapse}
          width={width}
          onResize={onResize}
          footer={
            <Button
              variant="destructive"
              className="w-full"
              disabled={!canDelete}
              onClick={() => onDelete(selectedControl.id)}
            >
              {t("common.actions.delete")}
            </Button>
          }
        >
          <p className="text-muted-foreground p-4 text-sm">
            {t("properties.multi_selection_hint")}
          </p>
        </PanelLayout>
      );
    }
    if (activeTab === "properties" && selectedControl) {
      const handleControlChange = (
        updates: Partial<FormField | Annotation>,
      ) => {
        onChange({ ...selectedControl, ...updates } as FormField | Annotation);
      };
      const isField = "name" in selectedControl && "style" in selectedControl;
      const canEditControl =
        canPerformPdfPermissionOperation(
          isField ? "edit_form_structure" : "edit_annotation",
          documentPermissions,
        ) && documentLoadState === "ready";

      return (
        <ControlPropertiesPanel
          data={selectedControl}
          onChange={handleControlChange}
          onDelete={() => onDelete(selectedControl.id)}
          onClose={onCollapse}
          isOpen={isOpen}
          onOpen={onOpen}
          onCollapse={onCollapse}
          isFloating={isFloating}
          onTriggerHistorySave={onTriggerHistorySave}
          canEdit={canEditControl}
          restrictedTitle={permissionUi.restrictedTitle}
          width={width}
          onResize={onResize}
        />
      );
    }

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
        canModifyContents={
          documentLoadState === "ready" &&
          canModifyPdfContents(documentPermissions)
        }
        isOpen={isOpen}
        onOpen={onOpen}
        onCollapse={onCollapse}
        onClose={onCollapse}
        isFloating={isFloating}
        onTriggerHistorySave={onTriggerHistorySave}
        width={width}
        onResize={onResize}
      />
    );
  },
);
