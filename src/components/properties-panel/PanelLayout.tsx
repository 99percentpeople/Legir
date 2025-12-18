import React, { useState, useCallback } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, setGlobalCursor, resetGlobalCursor } from "@/lib/utils";

export interface PanelLayoutProps {
  isFloating: boolean;
  onClose?: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width: number;
  onResize: (width: number) => void;
}

export const PanelLayout: React.FC<PanelLayoutProps> = ({
  isFloating,
  onClose,
  title,
  children,
  footer,
  width,
  onResize,
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const resizeStateRef = React.useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const onResizeRef = React.useRef(onResize);
  onResizeRef.current = onResize;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeStateRef.current = { startX: e.clientX, startWidth: width };
      setIsResizing(true);
    },
    [width],
  );

  React.useEffect(() => {
    if (!isResizing) return;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeStateRef.current) return;
      const { startX, startWidth } = resizeStateRef.current;
      // Dragging left edge: moving left (decreasing X) increases width
      const newWidth = startWidth + (startX - moveEvent.clientX);
      if (onResizeRef.current) {
        onResizeRef.current(Math.max(240, Math.min(600, newWidth)));
      }
    };

    const onMouseUp = () => {
      setIsResizing(false);
      resizeStateRef.current = null;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    setGlobalCursor("col-resize", "properties-resize");
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      resetGlobalCursor("properties-resize");
      document.body.style.removeProperty("user-select");
    };
  }, [isResizing]);

  return (
    <div
      className={cn(
        "bg-background border-border flex h-full flex-col border-l transition-colors duration-200",
        isFloating
          ? "absolute top-0 right-0 bottom-0 z-40 shadow-2xl"
          : "relative shadow-none",
      )}
      style={{ width: width }}
    >
      {/* Resize Handle */}
      <div
        className={cn(
          "absolute top-0 bottom-0 left-0 z-50 w-1 cursor-col-resize transition-colors",
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
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onClose}
            >
              <X size={18} />
            </Button>
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
