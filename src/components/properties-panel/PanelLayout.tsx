import React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  RIGHT_PANEL_MAX_WIDTH_PX,
  RIGHT_PANEL_MIN_WIDTH_PX,
} from "@/constants";
import { useResizableSidePanel } from "@/hooks/useResizableSidePanel";

export interface PanelLayoutProps {
  isFloating: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onClose?: () => void;
  onCollapse?: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width: number;
  onResize: (width: number) => void;
}

export const PanelLayout: React.FC<PanelLayoutProps> = ({
  isFloating,
  isOpen,
  onOpen,
  onClose,
  onCollapse,
  title,
  children,
  footer,
  width,
  onResize,
}) => {
  const { isResizing, handleMouseDown } = useResizableSidePanel({
    side: "right",
    isOpen,
    width,
    minWidth: RIGHT_PANEL_MIN_WIDTH_PX,
    maxWidth: RIGHT_PANEL_MAX_WIDTH_PX,
    onResize,
    onCollapse,
    onExpand: onOpen,
    cursorSource: "properties-resize",
  });

  if (!isOpen) {
    return (
      <>
        <div
          className={cn(
            "absolute top-0 right-0 bottom-0 z-40 w-1 cursor-col-resize transition-colors",
            isResizing ? "bg-border" : "hover:bg-primary/50",
          )}
          onMouseDown={handleMouseDown}
        />

        {isResizing && (
          <div className="fixed inset-0 z-9999 cursor-col-resize bg-transparent" />
        )}
      </>
    );
  }

  return (
    <div
      className={cn(
        "bg-background border-border flex h-full flex-col border-l duration-200",
        isResizing ? "transition-none" : "transition-colors",
        isFloating
          ? "absolute top-0 right-0 bottom-0 z-40 shadow-2xl"
          : "relative shadow-none",
      )}
      style={{ width: width }}
    >
      {/* Resize Handle */}
      <div
        className={cn(
          "absolute top-0 bottom-0 left-0 z-50 w-1 cursor-col-resize",
          isResizing ? "transition-none" : "transition-colors",
          isResizing ? "bg-primary/50" : "hover:bg-primary/50",
        )}
        onMouseDown={handleMouseDown}
      />

      {/* Resize Overlay */}
      {isResizing && (
        <div className="fixed inset-0 z-9999 cursor-col-resize bg-transparent" />
      )}

      {/* Header */}
      <div className="border-border bg-muted/30 flex items-center justify-between border-b p-4">
        <h3 className="text-foreground flex items-center gap-2 font-semibold">
          {title}
        </h3>
        <div className="flex items-center gap-1">
          {onClose ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onClose}
            >
              <X size={18} />
            </Button>
          ) : (
            <div className="h-8 w-8" />
          )}
        </div>
      </div>

      {/* Body */}
      <div className="scrollbar-thin scrollbar-thumb-border flex-1 space-y-6 overflow-y-auto p-4">
        {children}
      </div>

      {/* Footer */}
      {footer && (
        <div className="border-border bg-muted/30 border-t p-4">{footer}</div>
      )}
    </div>
  );
};
