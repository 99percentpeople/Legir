import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { resetGlobalCursor, setGlobalCursor } from "@/lib/cursor";

export interface FloatingWindowRenderContext {
  width: number;
  height: number;
  portalContainer: HTMLElement | null;
}

export interface FloatingWindowProps {
  isOpen: boolean;
  title: React.ReactNode;
  headerRight?:
    | React.ReactNode
    | ((ctx: FloatingWindowRenderContext) => React.ReactNode);
  onClose: () => void;
  closeLabel?: string;
  headerClassName?: string;
  bodyClassName?: string;
  closeButtonClassName?: string;
  children:
    | React.ReactNode
    | ((ctx: FloatingWindowRenderContext) => React.ReactNode);

  defaultSize?: { width: number; height: number };
  minSize?: { width: number; height: number };
  maxSize?: { width: number; height: number };

  defaultPosition?: { left: number; top: number } | "center";

  className?: string;
}

export const FloatingWindow: React.FC<FloatingWindowProps> = ({
  isOpen,
  title,
  headerRight,
  onClose,
  closeLabel = "Close",
  headerClassName,
  bodyClassName,
  closeButtonClassName,
  children,
  defaultSize = { width: 520, height: 560 },
  minSize = { width: 360, height: 420 },
  maxSize = { width: 980, height: 860 },
  defaultPosition = "center",
  className,
}) => {
  const windowRef = useRef<HTMLDivElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );

  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [size, setSize] = useState(defaultSize);

  const hasPositionedOnceRef = useRef(false);

  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);

  type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

  const resizeStateRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    startLeft: number;
    startTop: number;
    dir: ResizeDir;
  } | null>(null);

  const getResizeCursor = (dir: ResizeDir) => {
    if (dir === "n" || dir === "s") return "ns-resize";
    if (dir === "e" || dir === "w") return "ew-resize";
    if (dir === "ne" || dir === "sw") return "nesw-resize";
    return "nwse-resize";
  };

  const startResize = useCallback(
    (e: React.PointerEvent, dir: ResizeDir) => {
      e.preventDefault();
      e.stopPropagation();
      resizeStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startWidth: size.width,
        startHeight: size.height,
        startLeft: pos.left,
        startTop: pos.top,
        dir,
      };
      setGlobalCursor(getResizeCursor(dir), "floating-window");
      document.body.style.userSelect = "none";
    },
    [pos.left, pos.top, size.height, size.width],
  );

  useLayoutEffect(() => {
    if (!isOpen) return;
    if (hasPositionedOnceRef.current) return;

    const pad = 12;
    const w = size.width;
    const h = size.height;

    const initial =
      defaultPosition === "center"
        ? {
            left: Math.round((window.innerWidth - w) / 2),
            top: Math.round((window.innerHeight - h) / 2),
          }
        : defaultPosition;

    setPos({
      left: Math.max(pad, initial.left),
      top: Math.max(pad, initial.top),
    });

    hasPositionedOnceRef.current = true;
  }, [defaultPosition, isOpen, size.height, size.width]);

  useEffect(() => {
    if (!isOpen) return;

    const onMove = (e: PointerEvent) => {
      if (dragStateRef.current) {
        const { startX, startY, startLeft, startTop } = dragStateRef.current;

        const pad = 12;
        const nextLeft = startLeft + (e.clientX - startX);
        const nextTop = startTop + (e.clientY - startY);

        const clampedLeft = Math.max(
          pad,
          Math.min(window.innerWidth - size.width - pad, nextLeft),
        );
        const clampedTop = Math.max(
          pad,
          Math.min(window.innerHeight - size.height - pad, nextTop),
        );

        setPos({ left: clampedLeft, top: clampedTop });
        return;
      }

      if (resizeStateRef.current) {
        const {
          startX,
          startY,
          startWidth,
          startHeight,
          startLeft,
          startTop,
          dir,
        } = resizeStateRef.current;

        const pad = 12;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        const left0 = startLeft;
        const top0 = startTop;
        const right0 = startLeft + startWidth;
        const bottom0 = startTop + startHeight;

        let left = left0;
        let top = top0;
        let right = right0;
        let bottom = bottom0;

        if (dir.includes("w")) left = left0 + dx;
        if (dir.includes("e")) right = right0 + dx;
        if (dir.includes("n")) top = top0 + dy;
        if (dir.includes("s")) bottom = bottom0 + dy;

        // Size clamping (adjust the moving edge only).
        const clampWidth = (w: number) =>
          Math.max(minSize.width, Math.min(maxSize.width, w));
        const clampHeight = (h: number) =>
          Math.max(minSize.height, Math.min(maxSize.height, h));

        const widthRaw = right - left;
        const heightRaw = bottom - top;
        const width = clampWidth(widthRaw);
        const height = clampHeight(heightRaw);

        if (width !== widthRaw) {
          if (dir.includes("w") && !dir.includes("e")) {
            left = right - width;
          } else {
            right = left + width;
          }
        }

        if (height !== heightRaw) {
          if (dir.includes("n") && !dir.includes("s")) {
            top = bottom - height;
          } else {
            bottom = top + height;
          }
        }

        // Viewport clamping (adjust moving edge; keep opposite edge anchored).
        const maxRight = window.innerWidth - pad;
        const maxBottom = window.innerHeight - pad;

        if (dir.includes("w") && !dir.includes("e")) {
          left = Math.max(pad, Math.min(left, right - minSize.width));
          right = Math.min(maxRight, Math.max(right, left + minSize.width));
        } else if (dir.includes("e")) {
          right = Math.min(maxRight, Math.max(right, left + minSize.width));
        }

        if (dir.includes("n") && !dir.includes("s")) {
          top = Math.max(pad, Math.min(top, bottom - minSize.height));
          bottom = Math.min(maxBottom, Math.max(bottom, top + minSize.height));
        } else if (dir.includes("s")) {
          bottom = Math.min(maxBottom, Math.max(bottom, top + minSize.height));
        }

        // Final re-clamp to max sizes after viewport constraints.
        const finalWidth = clampWidth(right - left);
        const finalHeight = clampHeight(bottom - top);
        if (finalWidth !== right - left) {
          if (dir.includes("w") && !dir.includes("e"))
            left = right - finalWidth;
          else right = left + finalWidth;
        }
        if (finalHeight !== bottom - top) {
          if (dir.includes("n") && !dir.includes("s"))
            top = bottom - finalHeight;
          else bottom = top + finalHeight;
        }

        // Clamp whole rect in case start position was already out-of-bounds.
        left = Math.max(
          pad,
          Math.min(left, window.innerWidth - finalWidth - pad),
        );
        top = Math.max(
          pad,
          Math.min(top, window.innerHeight - finalHeight - pad),
        );

        setPos({ left, top });
        setSize({ width: finalWidth, height: finalHeight });
      }
    };

    const onUp = () => {
      dragStateRef.current = null;
      resizeStateRef.current = null;
      resetGlobalCursor("floating-window");
      document.body.style.removeProperty("user-select");
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);

    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [
    isOpen,
    maxSize.height,
    maxSize.width,
    minSize.height,
    minSize.width,
    size.height,
    size.width,
  ]);

  const ctx = useMemo<FloatingWindowRenderContext>(() => {
    return {
      width: size.width,
      height: size.height,
      portalContainer,
    };
  }, [portalContainer, size.height, size.width]);

  const setWindowEl = useCallback((el: HTMLDivElement | null) => {
    windowRef.current = el;
    setPortalContainer(el);
  }, []);

  const content =
    typeof children === "function" ? (children as any)(ctx) : children;

  const headerRightEl =
    typeof headerRight === "function" ? (headerRight as any)(ctx) : headerRight;

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={setWindowEl}
      className={cn(
        "bg-background fixed z-9999 flex flex-col overflow-visible rounded-lg border shadow-xl",
        className,
      )}
      style={{
        left: pos.left,
        top: pos.top,
        width: size.width,
        height: size.height,
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      <div
        className={cn(
          "flex cursor-move items-center justify-between border-b px-3 py-2",
          headerClassName,
        )}
        onPointerDown={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest?.("[data-floating-window-no-drag]")) return;
          e.preventDefault();
          dragStateRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startLeft: pos.left,
            startTop: pos.top,
          };
          setGlobalCursor("grabbing", "floating-window");
          document.body.style.userSelect = "none";
        }}
      >
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {title}
        </div>
        <div
          className="flex items-center gap-2"
          data-floating-window-no-drag
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
        >
          {headerRightEl}
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8", closeButtonClassName)}
            onClick={onClose}
            title={closeLabel}
            data-floating-window-no-drag
          >
            <X size={16} />
          </Button>
        </div>
      </div>

      <div className={cn("min-h-0 flex-1 overflow-hidden", bodyClassName)}>
        {content}
      </div>

      {/* Resize handles (8 directions) */}
      <div
        className="absolute top-0 left-0 h-3 w-3 cursor-nwse-resize bg-transparent"
        onPointerDown={(e) => startResize(e, "nw")}
      />
      <div
        className="absolute top-0 right-0 h-3 w-3 cursor-nesw-resize bg-transparent"
        onPointerDown={(e) => startResize(e, "ne")}
      />
      <div
        className="absolute bottom-0 left-0 h-3 w-3 cursor-nesw-resize bg-transparent"
        onPointerDown={(e) => startResize(e, "sw")}
      />
      <div
        className="absolute right-0 bottom-0 h-3 w-3 cursor-nwse-resize bg-transparent"
        onPointerDown={(e) => startResize(e, "se")}
      />

      <div
        className="absolute top-0 right-2 left-2 h-2 cursor-ns-resize bg-transparent"
        onPointerDown={(e) => startResize(e, "n")}
      />
      <div
        className="absolute right-2 bottom-0 left-2 h-2 cursor-ns-resize bg-transparent"
        onPointerDown={(e) => startResize(e, "s")}
      />
      <div
        className="absolute top-2 bottom-2 left-0 w-2 cursor-ew-resize bg-transparent"
        onPointerDown={(e) => startResize(e, "w")}
      />
      <div
        className="absolute top-2 right-0 bottom-2 w-2 cursor-ew-resize bg-transparent"
        onPointerDown={(e) => startResize(e, "e")}
      />
    </div>,
    document.body,
  );
};
