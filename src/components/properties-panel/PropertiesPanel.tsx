import React from "react";
import { FormField, Annotation, PDFMetadata } from "@/types";
import { DocumentPropertiesPanel } from "./DocumentPropertiesPanel";
import { ControlPropertiesPanel } from "./ControlPropertiesPanel";

// --- Main Container Component ---
interface PropertiesPanelProps {
  selectedControl: FormField | Annotation | null;
  metadata: PDFMetadata;
  filename: string;
  onChange: (updates: Partial<FormField | Annotation>) => void;
  onMetadataChange: (updates: Partial<PDFMetadata>) => void;
  onFilenameChange: (name: string) => void;
  onDelete: () => void;
  onClose: () => void;
  isFloating: boolean;
  onToggleFloating: () => void;
  onTriggerHistorySave: () => void;
  width: number;
  onResize: (width: number) => void;
}

export const PropertiesPanel = React.memo<PropertiesPanelProps>(
  ({
    selectedControl,
    metadata,
    filename,
    onChange,
    onMetadataChange,
    onFilenameChange,
    onDelete,
    onClose,
    isFloating,
    onToggleFloating,
    onTriggerHistorySave,
    width,
    onResize,
  }) => {
    if (selectedControl) {
      return (
        <ControlPropertiesPanel
          data={selectedControl}
          onChange={onChange}
          onDelete={onDelete}
          onClose={onClose}
          isFloating={isFloating}
          onToggleFloating={onToggleFloating}
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
        isFloating={isFloating}
        onToggleFloating={onToggleFloating}
        onTriggerHistorySave={onTriggerHistorySave}
        width={width}
        onResize={onResize}
      />
    );
  },
);
