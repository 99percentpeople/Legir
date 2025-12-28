import React, { useState, useMemo } from "react";
import { PDFMetadata } from "@/types";
import { FileText, Lock, Unlock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DateField, DateInput } from "@/components/ui/datafield-rac";
import { parseDateTime } from "@internationalized/date";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useLanguage } from "@/components/language-provider";
import { PanelLayout } from "./PanelLayout";
import { type Tag, TagInput } from "emblor";
import { cn } from "@/lib/cn";

export interface DocumentPropertiesPanelProps {
  metadata: PDFMetadata;
  onMetadataChange: (updates: Partial<PDFMetadata>) => void;
  filename: string;
  onFilenameChange: (name: string) => void;
  onClose?: () => void;
  isFloating: boolean;
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
    onClose,
    isFloating,
    onTriggerHistorySave,
    width,
    onResize,
  }) => {
    const { t } = useLanguage();
    const [creationEditable, setCreationEditable] = useState(false);

    const toCalendarDateTime = (dateStr?: string) => {
      if (!dateStr) return null;
      try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        const pad = (n: number) => n.toString().padStart(2, "0");
        const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        return parseDateTime(iso);
      } catch (e) {
        return null;
      }
    };

    return (
      <PanelLayout
        title={
          <>
            <FileText size={16} /> {t("properties.document.title")}
          </>
        }
        isFloating={isFloating}
        onClose={onClose}
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
            <KeywordsInput
              metadata={metadata}
              onMetadataChange={onMetadataChange}
              onTriggerHistorySave={onTriggerHistorySave}
            />
          </div>

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
            <Label className="flex items-center gap-1">
              {t("properties.producer")}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground cursor-help text-xs">
                      (?)
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">
                      {t("properties.producer_tooltip")}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <div className="relative">
              <Input
                type="text"
                value={metadata.producer || ""}
                disabled={!metadata.isProducerManual}
                onFocus={onTriggerHistorySave}
                onChange={(e) => onMetadataChange({ producer: e.target.value })}
                className={
                  !metadata.isProducerManual ? "text-muted-foreground pr-8" : ""
                }
              />
              <button
                onClick={() => {
                  if (!metadata.isProducerManual) {
                    // Switch to Manual: Keep current value but mark as manual
                    onMetadataChange({
                      isProducerManual: true,
                    });
                  } else {
                    // Switch to Auto
                    onMetadataChange({
                      isProducerManual: false,
                    });
                  }
                }}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
              >
                {metadata.isProducerManual ? (
                  <Unlock size={14} />
                ) : (
                  <Lock size={14} />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("properties.creation_date")}</Label>
            <div className="relative">
              <DateField
                aria-label={t("properties.creation_date")}
                value={toCalendarDateTime(metadata.creationDate)}
                onChange={(date) => {
                  if (date) {
                    onMetadataChange({
                      creationDate: date.toString(),
                    });
                  } else {
                    onMetadataChange({ creationDate: undefined });
                  }
                }}
                isDisabled={!creationEditable}
                granularity="minute"
                hourCycle={24}
              >
                <DateInput
                  className={cn(
                    "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50 md:text-sm",
                    "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                    "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
                  )}
                />
              </DateField>
              <button
                onClick={() => setCreationEditable(!creationEditable)}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 z-10 -translate-y-1/2"
              >
                {creationEditable ? <Unlock size={14} /> : <Lock size={14} />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              {t("properties.modification_date")}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground cursor-help text-xs">
                      (?)
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">
                      {t("properties.mod_date_tooltip")}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <div className="relative">
              <DateField
                aria-label={t("properties.modification_date")}
                value={toCalendarDateTime(metadata.modificationDate)}
                onChange={(date) => {
                  if (date) {
                    onMetadataChange({
                      modificationDate: date.toString(),
                    });
                  } else {
                    onMetadataChange({ modificationDate: undefined });
                  }
                }}
                isDisabled={!metadata.isModDateManual}
                granularity="minute"
                hourCycle={24}
              >
                <DateInput
                  className={cn(
                    "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50 md:text-sm",
                    "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                    "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
                  )}
                />
              </DateField>
              <button
                onClick={() => {
                  if (!metadata.isModDateManual) {
                    // Switch to Manual
                    onMetadataChange({
                      isModDateManual: true,
                    });
                  } else {
                    // Switch to Auto
                    onMetadataChange({
                      isModDateManual: false,
                    });
                  }
                }}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 z-10 -translate-y-1/2"
              >
                {metadata.isModDateManual ? (
                  <Unlock size={14} />
                ) : (
                  <Lock size={14} />
                )}
              </button>
            </div>
          </div>
        </div>
      </PanelLayout>
    );
  },
);

interface KeywordsInputProps {
  metadata: {
    keywords?: string | string[];
    [key: string]: any;
  };
  onMetadataChange: (data: any) => void;
  onTriggerHistorySave?: () => void;
}

function KeywordsInput({
  metadata,
  onMetadataChange,
  onTriggerHistorySave,
}: KeywordsInputProps) {
  const [activeTagIndex, setActiveTagIndex] = useState<number | null>(null);

  const tags: Tag[] = useMemo(() => {
    const kw = metadata.keywords;
    if (!kw) return [];
    const arr = Array.isArray(kw) ? kw : [kw];
    return arr.map((keyword) => ({
      id: keyword,
      text: keyword,
    }));
  }, [metadata.keywords]);

  const handleSetTags = (newTags: Tag[] | ((prevState: Tag[]) => Tag[])) => {
    let updatedTags: Tag[];

    if (typeof newTags === "function") {
      updatedTags = newTags(tags);
    } else {
      updatedTags = newTags;
    }

    const cleanKeywords = updatedTags.map((tag) => tag.text);

    onMetadataChange({
      keywords: cleanKeywords,
    });
  };

  return (
    <TagInput
      id="keywords-input"
      placeholder="(e.g. invoice)"
      tags={tags}
      setTags={handleSetTags}
      activeTagIndex={activeTagIndex}
      setActiveTagIndex={setActiveTagIndex}
      onFocus={onTriggerHistorySave}
      styleClasses={{
        inlineTagsContainer:
          "border-input rounded-md bg-transparent dark:bg-input/30 shadow-xs transition-[color,box-shadow] focus-within:border-ring outline-none focus-within:ring-[3px] focus-within:ring-ring/50 p-1 gap-1",
        input:
          "w-full min-w-[80px] shadow-none px-2 h-7 focus-visible:outline-none",
        tag: {
          body: "h-7 relative bg-background border border-input hover:bg-background rounded-md font-medium text-xs ps-2 pe-7 flex items-center",
          closeButton:
            "absolute -inset-y-px -end-px p-0 rounded-e-md flex size-7 transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] text-muted-foreground/80 hover:text-foreground justify-center items-center",
        },
      }}
    />
  );
}
