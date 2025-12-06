import React from "react";
import { PDFMetadata } from "@/types";
import { FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useLanguage } from "@/components/language-provider";
import { PanelLayout } from "./PanelLayout";

export interface DocumentPropertiesPanelProps {
  metadata: PDFMetadata;
  onMetadataChange: (updates: Partial<PDFMetadata>) => void;
  filename: string;
  onFilenameChange: (name: string) => void;
  isFloating: boolean;
  onToggleFloating: () => void;
  onTriggerHistorySave: () => void;
  width: number;
  onResize: (width: number) => void;
}

export const DocumentPropertiesPanel = React.memo<DocumentPropertiesPanelProps>(
  ({
    metadata,
    onMetadataChange,
    filename,
    onFilenameChange,
    isFloating,
    onToggleFloating,
    onTriggerHistorySave,
    width,
    onResize,
  }) => {
    const { t } = useLanguage();
    return (
      <PanelLayout
        title={
          <>
            <FileText size={16} /> {t("properties.document.title")}
          </>
        }
        isFloating={isFloating}
        onToggleFloating={onToggleFloating}
        width={width}
        onResize={onResize}
      >
        <div className="space-y-4">
          <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
            {t("properties.document.hint")}
          </div>

          <div className="space-y-2">
            <Label>{t("properties.filename")}</Label>
            <Input
              type="text"
              value={filename}
              onFocus={onTriggerHistorySave}
              onChange={(e) => onFilenameChange(e.target.value)}
              placeholder="document.pdf"
            />
            <p className="text-muted-foreground text-xs">
              {t("properties.filename.desc")}
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>{t("properties.doc_title")}</Label>
            <Input
              type="text"
              value={metadata.title || ""}
              onFocus={onTriggerHistorySave}
              onChange={(e) => onMetadataChange({ title: e.target.value })}
              placeholder="Untitled Document"
            />
          </div>

          <div className="space-y-2">
            <Label>{t("properties.author")}</Label>
            <Input
              type="text"
              value={metadata.author || ""}
              onFocus={onTriggerHistorySave}
              onChange={(e) => onMetadataChange({ author: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("properties.subject")}</Label>
            <Textarea
              rows={2}
              value={metadata.subject || ""}
              onFocus={onTriggerHistorySave}
              onChange={(e) => onMetadataChange({ subject: e.target.value })}
              className="resize-none"
            />
          </div>

          <div className="space-y-2">
            <Label>{t("properties.keywords")}</Label>
            <Input
              type="text"
              value={metadata.keywords || ""}
              onFocus={onTriggerHistorySave}
              onChange={(e) => onMetadataChange({ keywords: e.target.value })}
              placeholder="invoice, receipt, 2024"
            />
            <p className="text-muted-foreground text-xs">
              {t("properties.keywords.desc")}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("properties.creator")}</Label>
              <Input
                type="text"
                value={metadata.creator || ""}
                onFocus={onTriggerHistorySave}
                onChange={(e) => onMetadataChange({ creator: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("properties.producer")}</Label>
              <Input
                type="text"
                value={metadata.producer || ""}
                onFocus={onTriggerHistorySave}
                onChange={(e) => onMetadataChange({ producer: e.target.value })}
              />
            </div>
          </div>
        </div>
      </PanelLayout>
    );
  },
);
