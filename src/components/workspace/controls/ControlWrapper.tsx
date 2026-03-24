import React from "react";
import { cn } from "@/utils/cn";
import { ControlProps } from "./types";
import { appEventBus } from "@/lib/eventBus";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { getMoveDelta } from "@/lib/controlMovement";
import { useMouse } from "@/hooks/useMouse";
import { useLanguage } from "@/components/language-provider";
import type { Annotation, FormField, MoveDirection } from "@/types";
import {
  getInnerSizeFromOuterAabb,
  normalizeRightAngleRotationDeg,
  normalizeRotationDeg,
  rotateOuterRectKeepingCenter,
} from "@/lib/controlRotation";
import {
  ControlContextMenu,
  dispatchSyntheticContextMenuEscape,
  isContextMenuContentTarget,
} from "./ControlContextMenu";
import { ControlLayerMenuItems } from "./ControlLayerMenuItems";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

export type ControlWrapperProps = ControlProps & {
  customRect?: { x: number; y: number; width: number; height: number };
  showBorder?: boolean;
  resizable?: boolean;
  customElementId?: string;
  className?: string;
  contextMenuDisabled?: boolean;
  children?: React.ReactNode;
};

export const ControlWrapper: React.FC<ControlWrapperProps> = ({
  children,
  id,
  isSelected,
  isSelectable,
  onSelect,
  onResizeStart,
  onUpdate,
  onTriggerHistorySave,
  onReorderLayer,
  onResetToDefault,
  data,
  onPointerDown,
  customRect,
  showBorder = false,
  resizable = false,
  customElementId,
  className,
  contextMenuDisabled = false,
}) => {
  const { t } = useLanguage();
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const pendingFocusRef = React.useRef(false);
  const wasSelectedRef = React.useRef(isSelected);
  const contextMenuOpenRef = React.useRef(false);
  const isFreetext = data.type === "freetext";
  const {
    ref: tooltipMouseRef,
    x,
    y,
    width,
    height,
  } = useMouse<HTMLDivElement>();
  const [isTooltipOpen, setIsTooltipOpen] = React.useState(false);

  const dismissContextMenu = React.useCallback(() => {
    if (!contextMenuOpenRef.current) return false;
    contextMenuOpenRef.current = false;
    dispatchSyntheticContextMenuEscape();
    return true;
  }, []);

  useAppEvent(
    "workspace:focusControl",
    (payload) => {
      if (payload.id !== id) return;
      pendingFocusRef.current = true;
    },
    { replayLast: true },
  );

  const isAnnotation = [
    "comment",
    "highlight",
    "ink",
    "freetext",
    "link",
    "shape",
  ].includes(data.type);
  const isFormField = !isAnnotation;
  const supportsRotation = data.type === "freetext" || isFormField;
  const tooltipText =
    !isAnnotation && "toolTip" in data && typeof data.toolTip === "string"
      ? data.toolTip.trim()
      : "";

  const setWrapperNode = React.useCallback(
    (node: HTMLDivElement | null) => {
      wrapperRef.current = node;
      tooltipMouseRef(node);
    },
    [tooltipMouseRef],
  );

  React.useEffect(() => {
    if (!isSelected) return;
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;

    const el = wrapperRef.current;
    if (!el) return;

    if (!isAnnotation) {
      const input = el.querySelector(
        "input, textarea, select, [contenteditable='true']",
      ) as HTMLElement | null;
      try {
        input?.focus({ preventScroll: true });
      } catch {
        try {
          input?.focus();
        } catch {
          // ignore
        }
      }
    }

    appEventBus.clearSticky("workspace:focusControl");
  }, [isSelected, isAnnotation]);

  React.useEffect(() => {
    if (wasSelectedRef.current && !isSelected) {
      dismissContextMenu();
    }
    wasSelectedRef.current = isSelected;
  }, [dismissContextMenu, isSelected]);

  // Extract rect safely
  const baseRect = "rect" in data ? data.rect : undefined;
  const rect = customRect || baseRect;

  if (!rect) return null; // Skip if no rect (e.g. ink might be handled differently)

  const handleResizePointerDown = (e: React.PointerEvent, handle: string) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).focus({ preventScroll: true });
    } catch {
      // ignore
    }
    if (onResizeStart) {
      onResizeStart(handle, e);
    }
  };

  const handleDirectionKey = (
    key: string,
  ): { direction: MoveDirection; dx: number; dy: number } | null => {
    let direction: MoveDirection;
    if (key === "ArrowUp") direction = "UP";
    else if (key === "ArrowDown") direction = "DOWN";
    else if (key === "ArrowLeft") direction = "LEFT";
    else if (key === "ArrowRight") direction = "RIGHT";
    else return null;

    const { dx, dy } = getMoveDelta(direction, false);
    return { direction, dx, dy };
  };

  const getFreetextInnerRectFromOuterAabb = (outerRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    const rotationDeg =
      isFreetext &&
      typeof data.rotationDeg === "number" &&
      Number.isFinite(data.rotationDeg)
        ? data.rotationDeg
        : 0;

    if (rotationDeg === 0) {
      return outerRect;
    }

    const theta = (rotationDeg * Math.PI) / 180;
    const absCos = Math.abs(Math.cos(theta));
    const absSin = Math.abs(Math.sin(theta));
    const det = absCos * absCos - absSin * absSin;

    if (!Number.isFinite(det) || Math.abs(det) < 1e-6) {
      return outerRect;
    }

    const width = (outerRect.width * absCos - outerRect.height * absSin) / det;
    const height = (outerRect.height * absCos - outerRect.width * absSin) / det;

    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return outerRect;
    }

    const cx = outerRect.x + outerRect.width / 2;
    const cy = outerRect.y + outerRect.height / 2;

    return {
      x: cx - width / 2,
      y: cy - height / 2,
      width,
      height,
    };
  };

  const commitKeyboardRectUpdate = (nextRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    const actualRect = isFreetext
      ? getFreetextInnerRectFromOuterAabb(nextRect)
      : nextRect;

    if (isAnnotation) {
      (onUpdate as (id: string, updates: Partial<Annotation>) => void)(id, {
        rect: actualRect,
      });
      return;
    }

    (onUpdate as (id: string, updates: Partial<FormField>) => void)(id, {
      rect: actualRect,
    });
  };

  const getKeyboardResizedRect = (handle: string, dx: number, dy: number) => {
    let nextX = rect.x;
    let nextY = rect.y;
    let nextW = rect.width;
    let nextH = rect.height;

    if (handle.includes("e")) nextW += dx;
    if (handle.includes("w")) {
      nextX += dx;
      nextW -= dx;
    }
    if (handle.includes("s")) nextH += dy;
    if (handle.includes("n")) {
      nextY += dy;
      nextH -= dy;
    }

    if (nextW < 5) {
      if (handle.includes("w")) nextX = rect.x + rect.width - 5;
      nextW = 5;
    }
    if (nextH < 5) {
      if (handle.includes("n")) nextY = rect.y + rect.height - 5;
      nextH = 5;
    }

    if (
      nextX === rect.x &&
      nextY === rect.y &&
      nextW === rect.width &&
      nextH === rect.height
    ) {
      return null;
    }

    return { x: nextX, y: nextY, width: nextW, height: nextH };
  };

  const handleResizeHandleKeyDown =
    (handle: string) => (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!resizable || !isSelected || handle === "rotate") return;
      const directionMeta = handleDirectionKey(e.key);
      if (!directionMeta) return;

      e.preventDefault();
      e.stopPropagation();

      const step = e.shiftKey ? 10 : 1;
      const dx = directionMeta.dx * step;
      const dy = directionMeta.dy * step;
      const nextRect = getKeyboardResizedRect(handle, dx, dy);
      if (!nextRect) return;

      if (!e.repeat) {
        onTriggerHistorySave?.();
      }

      commitKeyboardRectUpdate(nextRect);
    };

  const handleRotateHandleKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (!supportsRotation || !isSelected) return;
    if (!rect) return;
    if (
      e.key !== "ArrowUp" &&
      e.key !== "ArrowDown" &&
      e.key !== "ArrowLeft" &&
      e.key !== "ArrowRight"
    ) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (!e.repeat) {
      onTriggerHistorySave?.();
    }

    const direction = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
    const currentRotation =
      typeof data.rotationDeg === "number" && Number.isFinite(data.rotationDeg)
        ? data.rotationDeg
        : 0;

    if (isAnnotation) {
      const step = e.shiftKey ? 15 : 1;
      const delta = direction * step;
      (onUpdate as (id: string, updates: Partial<Annotation>) => void)(id, {
        rotationDeg: normalizeRotationDeg(currentRotation + delta),
      });
      return;
    }

    const nextRotation = normalizeRightAngleRotationDeg(
      currentRotation + direction * 90,
    );
    (onUpdate as (id: string, updates: Partial<FormField>) => void)(id, {
      rect: rotateOuterRectKeepingCenter(rect, currentRotation, nextRotation),
      rotationDeg: nextRotation,
    });
  };

  // Get label for overlay
  const label = "name" in data ? (data as { name: string }).name : data.type;

  const rotationDeg =
    supportsRotation &&
    "rotationDeg" in data &&
    typeof data.rotationDeg === "number" &&
    Number.isFinite(data.rotationDeg)
      ? data.rotationDeg
      : 0;
  const shouldRenderRotatedOverlay =
    data.type === "freetext" && rotationDeg !== 0;

  const rotatedInnerOverlayGeometry = (() => {
    if (!shouldRenderRotatedOverlay) return null;
    if (!baseRect) return null;

    const innerLeft = (rect.width - baseRect.width) / 2;
    const innerTop = (rect.height - baseRect.height) / 2;

    return {
      innerW: baseRect.width,
      innerH: baseRect.height,
      innerLeft,
      innerTop,
    };
  })();
  const formFieldContentGeometry = (() => {
    if (!isFormField) return null;

    const innerSize = getInnerSizeFromOuterAabb(rect, rotationDeg);
    return {
      innerW: innerSize.width,
      innerH: innerSize.height,
      innerLeft: (rect.width - innerSize.width) / 2,
      innerTop: (rect.height - innerSize.height) / 2,
    };
  })();

  // Determine ID based on type for sidebar navigation
  const defaultElementId = isAnnotation
    ? `annotation-${id}`
    : `field-element-${id}`;
  const elementId =
    customElementId !== undefined ? customElementId : defaultElementId;

  const isInkHighlight =
    data.type === "ink" && "intent" in data && data.intent === "InkHighlight";
  const shouldRaiseZIndexWhenSelected =
    data.type !== "highlight" && !isInkHighlight;
  const supportsKeyboardResizeHandles = isSelected && resizable;
  const supportsKeyboardRotateHandle = isSelected && supportsRotation;
  const canShowLayerContextMenu =
    !contextMenuDisabled && isSelectable && data.type !== "shape";
  const hasControlContextMenu = canShowLayerContextMenu && !!onReorderLayer;
  const renderedChildren =
    isFormField && formFieldContentGeometry ? (
      <div
        className="absolute"
        style={{
          left: `calc(${formFieldContentGeometry.innerLeft}px * var(--scale, 1))`,
          top: `calc(${formFieldContentGeometry.innerTop}px * var(--scale, 1))`,
          width: `calc(${formFieldContentGeometry.innerW}px * var(--scale, 1))`,
          height: `calc(${formFieldContentGeometry.innerH}px * var(--scale, 1))`,
          transform: `rotate(${rotationDeg}deg)`,
          transformOrigin: "50% 50%",
        }}
      >
        {children}
      </div>
    ) : (
      children
    );
  const formFieldRotateHandle =
    isFormField && formFieldContentGeometry ? (
      <div
        className="pointer-events-none absolute"
        style={{
          left: `calc(${formFieldContentGeometry.innerLeft}px * var(--scale, 1))`,
          top: `calc(${formFieldContentGeometry.innerTop}px * var(--scale, 1))`,
          width: `calc(${formFieldContentGeometry.innerW}px * var(--scale, 1))`,
          height: `calc(${formFieldContentGeometry.innerH}px * var(--scale, 1))`,
          transform: `rotate(${rotationDeg}deg)`,
          transformOrigin: "50% 50%",
        }}
      >
        <div className="pointer-events-none absolute -top-3 left-1/2 z-20 h-3 w-0 -translate-x-1/2 border-l border-dashed border-blue-500" />
        <div
          className="pointer-events-auto absolute -top-6 left-1/2 z-30 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border border-blue-500 bg-white"
          onPointerDown={(e) => handleResizePointerDown(e, "rotate")}
          tabIndex={supportsKeyboardRotateHandle ? 0 : -1}
          data-ff-keyboard-handle="control-rotate"
          aria-label={`${label} rotate`}
          onKeyDown={
            supportsKeyboardRotateHandle ? handleRotateHandleKeyDown : undefined
          }
        />
      </div>
    ) : null;
  const resizeHandles = ["nw", "ne", "sw", "se"] as const;

  const getResizeHandleClassName = (handle: (typeof resizeHandles)[number]) =>
    cn(
      "pointer-events-auto absolute z-30 h-3 w-3 border border-blue-500 bg-white",
      handle === "nw" && "-top-1.5 -left-1.5 cursor-nwse-resize",
      handle === "ne" && "-top-1.5 -right-1.5 cursor-nesw-resize",
      handle === "sw" && "-bottom-1.5 -left-1.5 cursor-nesw-resize",
      handle === "se" && "-right-1.5 -bottom-1.5 cursor-nwse-resize",
    );

  const renderResizeHandles = () =>
    resizeHandles.map((handle) => (
      <div
        key={handle}
        className={getResizeHandleClassName(handle)}
        onPointerDown={(e) => handleResizePointerDown(e, handle)}
        tabIndex={supportsKeyboardResizeHandles ? 0 : -1}
        data-ff-keyboard-handle="control-resize"
        aria-label={`${label} resize ${handle}`}
        onKeyDown={
          supportsKeyboardResizeHandles
            ? handleResizeHandleKeyDown(handle)
            : undefined
        }
      />
    ));

  const renderRotateHandle = () => (
    <>
      <div className="pointer-events-none absolute -top-3 left-1/2 z-20 h-3 w-0 -translate-x-1/2 border-l border-dashed border-blue-500" />
      <div
        className="pointer-events-auto absolute -top-6 left-1/2 z-30 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border border-blue-500 bg-white"
        onPointerDown={(e) => handleResizePointerDown(e, "rotate")}
        tabIndex={supportsKeyboardRotateHandle ? 0 : -1}
        data-ff-keyboard-handle="control-rotate"
        aria-label={`${label} rotate`}
        onKeyDown={
          supportsKeyboardRotateHandle ? handleRotateHandleKeyDown : undefined
        }
      />
    </>
  );

  const wrapper = (
    <div
      ref={setWrapperNode}
      id={elementId || undefined}
      onPointerDownCapture={(e) => {
        if (!hasControlContextMenu) return;
        if (e.button !== 0) return;
        if (isContextMenuContentTarget(e.target)) return;
        if (!dismissContextMenu()) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => {
        if (!isSelectable) return;
        if (e.button !== 0) return;
        onPointerDown?.(e);
      }}
      onPointerEnter={tooltipText ? () => setIsTooltipOpen(true) : undefined}
      onPointerLeave={tooltipText ? () => setIsTooltipOpen(false) : undefined}
      onContextMenuCapture={() => {
        if (!isSelectable) return;
        onSelect(id);
      }}
      className={cn(
        "group absolute outline-none select-none",
        isSelectable
          ? "pointer-events-auto"
          : "pointer-events-none **:pointer-events-none",
        shouldRaiseZIndexWhenSelected && isSelected && "z-50",
        className,
      )}
      style={{
        left: `calc(${rect.x}px * var(--scale, 1))`,
        top: `calc(${rect.y}px * var(--scale, 1))`,
        width: `calc(${rect.width}px * var(--scale, 1))`,
        height: `calc(${rect.height}px * var(--scale, 1))`,
        cursor: isSelectable ? "pointer" : "inherit",
      }}
    >
      {renderedChildren}

      {/* Selection Overlay */}
      {showBorder &&
        (resizable ? (
          /* Resizable Overlay */
          <div className="pointer-events-none absolute inset-0">
            {shouldRenderRotatedOverlay ? (
              <>
                <div className="absolute inset-px border border-dashed border-blue-500" />
                <span className="absolute -top-6 left-0 z-30 rounded bg-blue-500 px-1.5 py-0.5 text-[10px] whitespace-nowrap shadow-sm">
                  {label}
                </span>
                <div
                  className="absolute"
                  style={{
                    left: rotatedInnerOverlayGeometry
                      ? `calc(${rotatedInnerOverlayGeometry.innerLeft}px * var(--scale, 1))`
                      : undefined,
                    top: rotatedInnerOverlayGeometry
                      ? `calc(${rotatedInnerOverlayGeometry.innerTop}px * var(--scale, 1))`
                      : undefined,
                    width: rotatedInnerOverlayGeometry
                      ? `calc(${rotatedInnerOverlayGeometry.innerW}px * var(--scale, 1))`
                      : undefined,
                    height: rotatedInnerOverlayGeometry
                      ? `calc(${rotatedInnerOverlayGeometry.innerH}px * var(--scale, 1))`
                      : undefined,
                    transform: `rotate(${rotationDeg}deg)`,
                    transformOrigin: "50% 50%",
                  }}
                >
                  <div className="absolute -inset-0.5 border-2 border-dashed border-blue-500" />
                  {renderResizeHandles()}
                  {renderRotateHandle()}
                </div>
              </>
            ) : (
              <>
                <div className="absolute -inset-0.5 border-2 border-dashed border-blue-500" />
                <span className="absolute -top-6 left-0 z-30 rounded bg-blue-500 px-1.5 py-0.5 text-[10px] whitespace-nowrap shadow-sm">
                  {label}
                </span>
                {renderResizeHandles()}

                {supportsRotation && (
                  <>{formFieldRotateHandle ?? renderRotateHandle()}</>
                )}
              </>
            )}
          </div>
        ) : (
          /* Non-Resizable Annotation Focus Overlay */
          <div className="pointer-events-none absolute inset-0 z-50 border border-dashed border-blue-500" />
        ))}
    </div>
  );

  const canResetFormControlToDefault = !isAnnotation && !!onResetToDefault;
  const triggerElement = tooltipText ? (
    <TooltipTrigger asChild>{wrapper}</TooltipTrigger>
  ) : (
    wrapper
  );

  const contextMenuWrapped = hasControlContextMenu ? (
    <ControlContextMenu
      onOpenChange={(open) => {
        contextMenuOpenRef.current = open;
      }}
      content={
        <>
          {canResetFormControlToDefault && (
            <>
              <ContextMenuItem onSelect={() => onResetToDefault(id)}>
                {t("common.actions.reset_to_default")}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ControlLayerMenuItems
            onSelect={(move) => onReorderLayer(id, move)}
          />
        </>
      }
    >
      {triggerElement}
    </ControlContextMenu>
  ) : (
    triggerElement
  );

  if (!tooltipText) {
    return contextMenuWrapped;
  }

  return (
    <Tooltip delayDuration={0} disableHoverableContent open={isTooltipOpen}>
      {contextMenuWrapped}
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          align="center"
          side="bottom"
          sideOffset={36}
          hideWhenDetached
          className="group z-50"
          style={{
            transform: `translate(${x - width / 2}px, ${y - height}px)`,
          }}
        >
          <div
            className={cn(
              "dark bg-background text-foreground pointer-events-none rounded-md px-2 py-1 text-xs whitespace-pre-wrap opacity-80 shadow-sm",
              "animate-in fade-in-0 zoom-in-95 group-data-[side=bottom]:slide-in-from-top-2 group-data-[side=left]:slide-in-from-right-2 group-data-[side=right]:slide-in-from-left-2 group-data-[side=top]:slide-in-from-bottom-2",
              "group-data-[state=closed]:animate-out group-data-[state=closed]:fade-out-0 group-data-[state=closed]:zoom-out-95",
            )}
          >
            {tooltipText}
          </div>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </Tooltip>
  );
};
