import React from "react";
import { ChevronDown } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { ToolTimelineItem, ToolTimelinePreviewImage } from "./types";

export const ToolTimelineCall = ({
  item,
  grouped = false,
}: {
  item: ToolTimelineItem;
  grouped?: boolean;
}) => {
  const { t } = useLanguage();
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const resultText = item.resultText?.trim();
  const previewImages = item.previewImages ?? [];

  const content = (
    <div className="space-y-2">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group focus-visible:ring-ring/50 mb-0 flex w-full items-start justify-between gap-2 rounded-md p-1 text-left transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
          aria-label={t("ai_chat.tool_details")}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="text-muted-foreground font-mono text-xs">
                {item.toolName}
              </div>
              {item.status !== "done" ? (
                <Badge
                  className="h-5 px-1.5 text-[10px]"
                  variant={item.status === "error" ? "destructive" : "outline"}
                >
                  {item.status === "running" ? <Spinner size="sm" /> : null}
                  {item.status}
                </Badge>
              ) : null}
            </div>
            {item.resultSummary ? (
              <div className="text-xs">{item.resultSummary}</div>
            ) : null}
            {item.error ? (
              <div className="text-destructive text-xs">{item.error}</div>
            ) : null}
          </div>

          <ChevronDown className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-2">
        <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          {t("ai_chat.tool_args")}
        </div>
        <div className="text-muted-foreground bg-muted/40 rounded-md px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap">
          {item.argsText}
        </div>

        {previewImages.length ? (
          <div className="space-y-2">
            <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              {t("sidebar.thumbnails")}
            </div>
            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {previewImages.map((preview) => (
                <ToolTimelineImagePreview key={preview.id} preview={preview} />
              ))}
            </div>
          </div>
        ) : null}

        {resultText ? (
          <>
            <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              {t("ai_chat.tool_result")}
            </div>
            <div className="text-muted-foreground bg-muted/40 max-h-64 overflow-auto rounded-md px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap">
              {resultText}
            </div>
          </>
        ) : null}
      </CollapsibleContent>
    </div>
  );

  return (
    <Collapsible
      defaultOpen={false}
      open={detailsOpen}
      onOpenChange={setDetailsOpen}
    >
      {grouped ? (
        <div className="p-1.5">{content}</div>
      ) : (
        <Card className="bg-background">
          <CardContent className="p-1.5">{content}</CardContent>
        </Card>
      )}
    </Collapsible>
  );
};

const ToolTimelineImagePreview = ({
  preview,
}: {
  preview: ToolTimelinePreviewImage;
}) => {
  const [open, setOpen] = React.useState(false);
  const dimensionLabel =
    preview.width && preview.height
      ? `${preview.width}×${preview.height}`
      : undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-muted/30 border-border/60 hover:border-border block shrink-0 overflow-hidden rounded-md border text-left transition-colors"
        title={preview.label}
      >
        <img
          src={preview.src}
          alt={preview.alt}
          className="block aspect-square h-28 max-w-[220px] bg-white object-cover"
          loading="lazy"
        />
        <div className="text-muted-foreground border-border/60 border-t px-2 py-1 text-[11px]">
          {preview.label}
          {dimensionLabel ? ` · ${dimensionLabel}` : ""}
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col gap-3 overflow-hidden p-4 sm:max-w-5xl">
          <DialogHeader className="space-y-1">
            <DialogTitle className="min-w-0 truncate text-sm">
              {preview.label}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {dimensionLabel ?? preview.alt}
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted/20 border-border/60 flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-md border p-2">
            <img
              src={preview.src}
              alt={preview.alt}
              className="block h-auto max-h-[75vh] w-auto max-w-full object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
