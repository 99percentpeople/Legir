import React from "react";
import { FormField, Annotation, PDFMetadata } from "@/types";
import { DocumentPropertiesPanel } from "./DocumentPropertiesPanel";
import { ControlPropertiesPanel } from "./ControlPropertiesPanel";
import { useEditorStore } from "@/store/useEditorStore";
import { useShallow } from "zustand/react/shallow";
import { selectPropertiesPanelState } from "@/store/selectors";

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
    const { exportPassword, pdfOpenPassword, setEditorState } = useEditorStore(
      useShallow(selectPropertiesPanelState),
    );

    if (activeTab === "properties" && selectedControl) {
      return (
        <ControlPropertiesPanel
          data={selectedControl}
          onChange={onChange}
          onDelete={() => onDelete(selectedControl.id)}
          onClose={onClose}
          isOpen={isOpen}
          onOpen={onOpen}
          onCollapse={onCollapse}
          isFloating={isFloating}
          onTriggerHistorySave={onTriggerHistorySave}
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
        onExportPasswordChange={(password) => {
          setEditorState({ exportPassword: password, isDirty: true });
        }}
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
