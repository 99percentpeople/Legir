import React from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useStickyBottomScroll } from "../useStickyBottomScroll";
import type {
  ToolTimelineItem,
  ToolTimelinePreviewImage,
  TranslateFn,
} from "./types";

export const ToolTimelineCall = ({
  item,
  t,
  grouped = false,
}: {
  item: ToolTimelineItem;
  t: TranslateFn;
  grouped?: boolean;
}) => {
  const hasProgressSnapshot =
    item.status === "running" &&
    (Boolean(item.progressCounts) ||
      (Array.isArray(item.progressDetails) && item.progressDetails.length > 0));
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const progressLogs = hasProgressSnapshot ? (item.progressDetails ?? []) : [];
  const progressLogRef = React.useRef<HTMLDivElement | null>(null);
  const { scrollToBottom: scrollProgressLogToBottom } = useStickyBottomScroll(
    progressLogRef,
    {
      enabled: detailsOpen && progressLogs.length > 0,
      settleFrames: 2,
      threshold: 32,
    },
  );
  const resultText = item.resultText?.trim();
  const previewImages = item.previewImages ?? [];

  React.useEffect(() => {
    if (!detailsOpen || progressLogs.length === 0) return;
    scrollProgressLogToBottom(false);
  }, [detailsOpen, progressLogs, scrollProgressLogToBottom]);

  React.useEffect(() => {
    if (!detailsOpen) return;
    scrollProgressLogToBottom(true);
  }, [detailsOpen, scrollProgressLogToBottom]);

  const content = (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
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
            <div className="text-destructive text-sm">{item.error}</div>
          ) : null}
        </div>

        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="group h-7 w-7 shrink-0"
            aria-label={t("ai_chat.tool_details")}
          >
            <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="space-y-2">
        <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          {t("ai_chat.tool_args")}
        </div>
        <div className="text-muted-foreground bg-muted/40 rounded-md px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap">
          {item.argsText}
        </div>

        {progressLogs.length ? (
          <div className="space-y-2">
            <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              {t("ai_chat.tool_schedule_log")}
            </div>
            <div
              ref={progressLogRef}
              className="bg-muted/35 border-border/50 max-h-48 space-y-1 overflow-y-auto rounded-md border px-2.5 py-2 font-mono text-[11px]"
            >
              {progressLogs.map((logLine, index) => (
                <div
                  key={`${item.id}:progress-log:${index}`}
                  className="text-muted-foreground break-all whitespace-pre-wrap"
                >
                  {logLine}
                </div>
              ))}
            </div>
          </div>
        ) : null}

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
        <div className="px-2 py-1.5">{content}</div>
      ) : (
        <Card className="bg-background">
          <CardContent className="px-2 py-1">{content}</CardContent>
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
