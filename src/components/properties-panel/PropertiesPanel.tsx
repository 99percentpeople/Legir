import React from "react";
import { FormField, Annotation, PDFMetadata } from "@/types";
import { DocumentPropertiesPanel } from "./DocumentPropertiesPanel";
import { ControlPropertiesPanel } from "./ControlPropertiesPanel";

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
    isFloating,
    onTriggerHistorySave,
    width,
    onResize,
  }) => {
    if (activeTab === "properties" && selectedControl) {
      return (
        <ControlPropertiesPanel
          data={selectedControl}
          onChange={onChange}
          onDelete={onDelete}
          onClose={onClose}
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
        onClose={onCollapse}
        isFloating={isFloating}
        onTriggerHistorySave={onTriggerHistorySave}
        width={width}
        onResize={onResize}
      />
    );
  },
);
