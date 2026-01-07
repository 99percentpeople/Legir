import React from "react";
import { FormField, Annotation, PDFMetadata } from "@/types";
import { DocumentPropertiesPanel } from "./DocumentPropertiesPanel";
import { ControlPropertiesPanel } from "./ControlPropertiesPanel";
import { useEditorStore } from "@/store/useEditorStore";

// --- Main Container Component ---
interface PropertiesPanelProps {
  selectedControl: FormField | Annotation | null;
  activeTab: string;
  metadata: PDFMetadata;
  filename: string;
  onChange: (updates: Partial<FormField | Annotation>) => void;
  onMetadataChange: (updates: Partial<PDFMetadata>) => void;
  onFilenameChange: (name: string) => void;
  onDelete: () => void;
  onClose: () => void;
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
    const exportPassword = useEditorStore((s) => s.exportPassword);
    const pdfOpenPassword = useEditorStore((s) => s.pdfOpenPassword);
    const setEditorState = useEditorStore((s) => s.setState);

    if (activeTab === "properties" && selectedControl) {
      return (
        <ControlPropertiesPanel
          data={selectedControl}
          onChange={onChange}
          onDelete={onDelete}
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
