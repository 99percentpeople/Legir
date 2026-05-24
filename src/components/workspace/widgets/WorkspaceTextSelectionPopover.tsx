import React from "react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Copy, Highlighter, Languages, Search, Sparkles } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { usePdfPermissionUi } from "@/hooks/usePdfPermissionUi";
import type { PDFDocumentPermissions } from "@/types";

export type WorkspaceTextSelectionPopoverState = {
  isVisible: boolean;
  left: number;
  top: number;
  text: string;
};

export interface WorkspaceTextSelectionPopoverProps {
  toolbar: WorkspaceTextSelectionPopoverState;
  virtualRef: React.ComponentProps<typeof PopoverAnchor>["virtualRef"];
  documentPermissions: PDFDocumentPermissions | null | undefined;
  onClose: () => void;
  onHighlight: () => void;
  onSearchWeb: () => void;
  onTranslate: () => void;
  onAskAi: () => void;
}

export const WorkspaceTextSelectionPopover: React.FC<
  WorkspaceTextSelectionPopoverProps
> = ({
  toolbar,
  virtualRef,
  documentPermissions,
  onClose,
  onHighlight,
  onSearchWeb,
  onTranslate,
  onAskAi,
}) => {
  const { t } = useLanguage();
  const permissionUi = usePdfPermissionUi(documentPermissions);
  const selectedText = toolbar.text.trim();
  const canCopyText = permissionUi.can("copy_text");

  return (
    <Popover
      open={toolbar.isVisible}
      onOpenChange={(open) => {
        if (open) return;
        onClose();
      }}
    >
      <PopoverAnchor virtualRef={virtualRef} />

      <PopoverTrigger asChild>
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed z-60 h-px w-px opacity-0"
          style={{
            left: toolbar.left,
            top: toolbar.top,
          }}
        />
      </PopoverTrigger>

      <PopoverContent
        data-app-text-selection-popover="1"
        data-app-block-modifier-wheel-zoom="1"
        side="top"
        align="center"
        sideOffset={8}
        className="z-60 w-auto rounded-md border p-1 shadow-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-disabled={canCopyText && selectedText ? undefined : true}
            disabled={!canCopyText || !selectedText}
            title={
              canCopyText
                ? t("common.actions.copy")
                : permissionUi.restrictedTitle
            }
            onClick={() => {
              permissionUi.guard("copy_text", () => {
                if (!selectedText) return;
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(selectedText);
                  } catch {
                    // Ignore clipboard failures; the user can still use the selection.
                  } finally {
                    onClose();
                  }
                })();
              });
            }}
          >
            <Copy size={16} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            {...permissionUi.disabledProps(
              "create_annotation",
              t("toolbar.highlight"),
            )}
            onClick={() => {
              permissionUi.guard("create_annotation", onHighlight);
            }}
          >
            <Highlighter size={16} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={t("toolbar.translate")}
            onClick={() => {
              onTranslate();
            }}
          >
            <Languages size={16} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={t("toolbar.ask_ai", { text: selectedText })}
            onClick={() => {
              onAskAi();
            }}
          >
            <Sparkles size={16} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={t("toolbar.search_web", { text: selectedText })}
            onClick={() => {
              onSearchWeb();
            }}
          >
            <Search size={16} />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
