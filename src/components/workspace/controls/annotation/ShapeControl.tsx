import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { Palette, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useLanguage } from "@/components/language-provider";
import { ColorPickerPopover } from "@/components/toolbar/ColorPickerPopover";
import { ShapeBorderStyleSection } from "@/components/toolbar/ShapeBorderStyleSection";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useMouse } from "@/hooks/useMouse";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { getRotatedOuterRect } from "@/lib/controlRotation";
import {
  getDefaultArrowSize,
  getLineEndingMarker,
  getShapeMarkerStrokeLinecap,
  getShapeMarkerStrokeLinejoin,
  getShapeArrowStyles,
  getShapeArrowStyleUpdates,
  getShapeTypeAfterPointDeletion,
  getShapeTypeAfterPointInsertion,
  getShapeTypeWithoutArrow,
  getCloudGeometry,
  getCloudPathData,
  getPolygonCloudGeometry,
  getRectAndNormalizedShapePoints,
  getShapeAbsolutePoints,
  getShapeStrokeLinecap,
  getShapeStrokeLinejoin,
  getShapeStrokeDashArray,
  isClosedShapeType,
  getShapeMinimumPointCount,
  getShapePointsPathData,
  normalizeShapeBorderStyle,
  normalizeShapeDashDensity,
  rotateShapePoint,
  snapShapePointBetweenAnchors,
  snapShapePointToAngle,
  SHAPE_ARROW_STYLE_OPTIONS,
  type ShapeArrowStyle,
  getTrimmedOpenLinePointsForArrows,
  isOpenLineEndpointIndex,
  isOpenLineShapeType,
  insertShapePointAtSegment,
  removeShapePoint,
  shapeSupportsVertexInsertion,
  shapeSupportsVertices,
} from "@/lib/shapeGeometry";
import { getMoveDelta } from "@/lib/controlMovement";
import { getContrastColor } from "@/utils/colors";
import type { MoveDirection } from "@/types";

import { FloatingToolbar } from "../FloatingToolbar";
import { ControlLayerMenuItems } from "../ControlLayerMenuItems";
import {
  dispatchSyntheticContextMenuEscape,
  isContextMenuContentTarget,
} from "../ControlContextMenu";
import { ControlWrapper } from "../ControlWrapper";
import type { AnnotationControlProps } from "../types";
import { AnnotationAskAiButton } from "./AnnotationAskAiButton";

const HIT_TEST_PAINT = "rgba(0, 0, 0, 0.001)";

export const ShapeControl: React.FC<AnnotationControlProps> = (props) => {
  const {
    data,
    isSelected,
    isSelectable,
    isAnnotationMode,
    onUpdate,
    onDelete,
    onAskAi,
    onTriggerHistorySave,
  } = props;

  if (!data.rect || data.type !== "shape" || !data.shapeType) return null;
  const { t } = useLanguage();
  const rect = data.rect;
  const shapeType = data.shapeType;

  const strokeColor = data.color || "#000000";
  const strokeWidth =
    typeof data.thickness === "number" && Number.isFinite(data.thickness)
      ? Math.max(0, data.thickness)
      : 2;
  const strokeOpacity =
    typeof data.opacity === "number" && Number.isFinite(data.opacity)
      ? Math.max(0, Math.min(1, data.opacity))
      : 1;
  const fillOpacity =
    typeof data.backgroundOpacity === "number" &&
    Number.isFinite(data.backgroundOpacity)
      ? Math.max(0, Math.min(1, data.backgroundOpacity))
      : strokeOpacity;
  const fillColor = data.backgroundColor || "none";
  const hasStroke = strokeOpacity > 0 && strokeWidth > 0;
  const hasFill = fillOpacity > 0 && fillColor !== "none";
  const borderStyle = normalizeShapeBorderStyle(data.borderStyle) ?? "solid";
  const dashDensity = normalizeShapeDashDensity(data.dashDensity);
  const strokeLinecap = getShapeStrokeLinecap(shapeType);
  const strokeLinejoin = getShapeStrokeLinejoin(shapeType);
  const strokeDasharray = getShapeStrokeDashArray(
    borderStyle,
    strokeWidth,
    dashDensity,
  );
  const segmentHitWidth = Math.max(12, strokeWidth * 4);
  const hasVertices = shapeSupportsVertices(shapeType);
  const isOpenLineShape = isOpenLineShapeType(shapeType);
  const rotationDeg =
    typeof data.rotationDeg === "number" && Number.isFinite(data.rotationDeg)
      ? data.rotationDeg
      : 0;
  const rotationCenter = useMemo(
    () => ({
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    }),
    [rect],
  );
  const rotatedOuterRect = useMemo(
    () =>
      rotationDeg !== 0 ? getRotatedOuterRect(rect, rotationDeg) : undefined,
    [rect, rotationDeg],
  );
  const arrowStyles = useMemo(
    () => getShapeArrowStyles(data),
    [
      data.shapeEndArrow,
      data.shapeEndArrowStyle,
      data.shapeStartArrow,
      data.shapeStartArrowStyle,
      shapeType,
    ],
  );
  const arrowSize =
    typeof data.arrowSize === "number" && Number.isFinite(data.arrowSize)
      ? Math.max(6, data.arrowSize)
      : getDefaultArrowSize(strokeWidth);
  const absolutePoints = useMemo(() => getShapeAbsolutePoints(data), [data]);
  const localPoints = useMemo(
    () =>
      absolutePoints.map((point) => ({
        x: point.x - rect.x,
        y: point.y - rect.y,
      })),
    [absolutePoints, rect],
  );
  const trimmedLocalPoints = useMemo(
    () =>
      isOpenLineShape && (arrowStyles.start || arrowStyles.end)
        ? getTrimmedOpenLinePointsForArrows(
            localPoints,
            arrowStyles,
            strokeWidth,
            arrowSize,
          )
        : localPoints,
    [arrowSize, arrowStyles, isOpenLineShape, localPoints, strokeWidth],
  );
  const startArrowMarker = useMemo(
    () =>
      isOpenLineShape
        ? getLineEndingMarker(
            localPoints,
            "start",
            arrowStyles.start,
            strokeWidth,
            arrowSize,
          )
        : null,
    [arrowSize, arrowStyles.start, isOpenLineShape, localPoints, strokeWidth],
  );
  const endArrowMarker = useMemo(
    () =>
      isOpenLineShape
        ? getLineEndingMarker(
            localPoints,
            "end",
            arrowStyles.end,
            strokeWidth,
            arrowSize,
          )
        : null,
    [arrowSize, arrowStyles.end, isOpenLineShape, localPoints, strokeWidth],
  );
  const startArrowStrokeLinecap = getShapeMarkerStrokeLinecap(
    arrowStyles.start,
  );
  const startArrowStrokeLinejoin = getShapeMarkerStrokeLinejoin(
    arrowStyles.start,
  );
  const endArrowStrokeLinecap = getShapeMarkerStrokeLinecap(arrowStyles.end);
  const endArrowStrokeLinejoin = getShapeMarkerStrokeLinejoin(arrowStyles.end);
  const polyPath = useMemo(
    () =>
      getShapePointsPathData(
        isOpenLineShape && (arrowStyles.start || arrowStyles.end)
          ? trimmedLocalPoints
          : localPoints,
        {
          closed: isClosedShapeType(data.shapeType),
        },
      ),
    [
      arrowStyles.end,
      arrowStyles.start,
      data.shapeType,
      isOpenLineShape,
      localPoints,
      trimmedLocalPoints,
    ],
  );
  const segmentTargets = useMemo(() => {
    if (
      !shapeSupportsVertexInsertion(data.shapeType) ||
      localPoints.length < 2
    ) {
      return [];
    }

    const targets = localPoints.slice(0, -1).map((point, index) => ({
      index,
      d: `M ${point.x} ${point.y} L ${localPoints[index + 1]!.x} ${localPoints[index + 1]!.y}`,
    }));

    if (isClosedShapeType(data.shapeType)) {
      const lastPoint = localPoints[localPoints.length - 1]!;
      const firstPoint = localPoints[0]!;
      targets.push({
        index: localPoints.length - 1,
        d: `M ${lastPoint.x} ${lastPoint.y} L ${firstPoint.x} ${firstPoint.y}`,
      });
    }

    return targets;
  }, [data.shapeType, localPoints]);
  const cloudPath = useMemo(() => {
    if (data.shapeType !== "cloud") return "";
    const geometry = getCloudGeometry(
      {
        x: 0,
        y: 0,
        width: data.rect!.width,
        height: data.rect!.height,
      },
      {
        intensity: data.cloudIntensity,
        strokeWidth,
        spacing: data.cloudSpacing,
      },
    );
    return getCloudPathData(
      geometry.pathRect,
      geometry.intensity,
      geometry.spacing,
    );
  }, [
    data.cloudIntensity,
    data.cloudSpacing,
    data.rect,
    data.shapeType,
    strokeWidth,
  ]);
  const cloudPolygonGeometry = useMemo(() => {
    if (data.shapeType !== "cloud_polygon") return null;
    return getPolygonCloudGeometry(localPoints, {
      intensity: data.cloudIntensity,
      spacing: data.cloudSpacing,
      strokeWidth,
    });
  }, [
    data.cloudIntensity,
    data.cloudSpacing,
    data.shapeType,
    localPoints,
    strokeWidth,
  ]);
  const cloudPolygonPath =
    data.shapeType === "cloud_polygon"
      ? (cloudPolygonGeometry?.pathData ?? "")
      : "";
  const cloudPolygonSelectionSegments =
    cloudPolygonGeometry?.segmentPaths ?? [];

  const [contextState, setContextState] = useState<{
    point: { x: number; y: number } | null;
    segmentIndex: number | null;
    vertexIndex: number | null;
  }>({
    point: null,
    segmentIndex: null,
    vertexIndex: null,
  });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const {
    ref: hoverRef,
    x: hoverX,
    y: hoverY,
    width: hoverWidth,
    height: hoverHeight,
  } = useMouse<SVGSVGElement>();
  const menuTriggerRef = useRef<HTMLDivElement | null>(null);
  const vertexDragIndexRef = useRef<number | null>(null);
  const activeVertexPointerRef = useRef<{
    pointerId: number;
    element: HTMLDivElement | null;
  } | null>(null);
  const pendingTouchVertexDragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    vertexIndex: number;
  } | null>(null);
  const pinchGestureActiveRef = useRef(false);
  const contextMenuOpenRef = useRef(false);
  const [menuAnchor, setMenuAnchor] = useState({ x: 0, y: 0 });
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const tooltipText = data.text?.trim() || "";

  const resetContextState = useCallback(() => {
    setContextState({
      point: null,
      segmentIndex: null,
      vertexIndex: null,
    });
  }, []);

  const dismissContextMenu = useCallback(() => {
    if (!contextMenuOpenRef.current) return;
    contextMenuOpenRef.current = false;
    dispatchSyntheticContextMenuEscape();
  }, []);

  useEffect(() => {
    if (isSelected) return;
    resetContextState();
    dismissContextMenu();
  }, [dismissContextMenu, isSelected, resetContextState]);

  useAppEvent("workspace:pinchGestureActiveChange", ({ active }) => {
    pinchGestureActiveRef.current = active;
    if (!active) return;

    pendingTouchVertexDragRef.current = null;
    vertexDragIndexRef.current = null;
    const activeVertexPointer = activeVertexPointerRef.current;
    if (activeVertexPointer) {
      try {
        activeVertexPointer.element?.releasePointerCapture(
          activeVertexPointer.pointerId,
        );
      } catch {
        // ignore
      }
    }
    activeVertexPointerRef.current = null;
  });

  const setSvgRefs = useCallback(
    (node: SVGSVGElement | null) => {
      svgRef.current = node;
      hoverRef(node);
    },
    [hoverRef],
  );

  const tooltipHoverProps = tooltipText
    ? {
        onMouseEnter: () => setIsTooltipOpen(true),
        onMouseLeave: () => setIsTooltipOpen(false),
      }
    : undefined;

  const getAbsolutePointFromClientPosition = (
    clientX: number,
    clientY: number,
  ) => {
    const bounds =
      svgRef.current?.parentElement?.getBoundingClientRect() ??
      svgRef.current?.getBoundingClientRect();
    const interactionRect = rotatedOuterRect ?? data.rect!;
    if (!bounds) {
      return {
        x: data.rect!.x,
        y: data.rect!.y,
      };
    }
    const localX =
      ((clientX - bounds.left) / Math.max(1, bounds.width)) *
      interactionRect.width;
    const localY =
      ((clientY - bounds.top) / Math.max(1, bounds.height)) *
      interactionRect.height;
    const nextPoint = {
      x: interactionRect.x + localX,
      y: interactionRect.y + localY,
    };
    return rotationDeg !== 0
      ? rotateShapePoint(nextPoint, rotationCenter, -rotationDeg)
      : nextPoint;
  };

  const commitAbsolutePoints = (
    points: { x: number; y: number }[],
    nextShapeType: NonNullable<typeof data.shapeType> = shapeType,
    extraUpdates: Partial<typeof data> = {},
  ) => {
    const normalized = getRectAndNormalizedShapePoints(points);
    if (!normalized) return;
    onUpdate(data.id, {
      shapeType: nextShapeType,
      rect: normalized.rect,
      shapePoints: normalized.shapePoints,
      appearanceStreamContent: undefined,
      ...extraUpdates,
    });
  };

  const endpointVertexIndex =
    contextState.vertexIndex !== null &&
    isOpenLineEndpointIndex(
      shapeType,
      absolutePoints.length,
      contextState.vertexIndex,
    )
      ? contextState.vertexIndex
      : null;
  const endpointArrowSide =
    endpointVertexIndex === null
      ? null
      : endpointVertexIndex === 0
        ? "start"
        : "end";
  const endpointArrowStyle =
    endpointArrowSide === "start"
      ? arrowStyles.start
      : endpointArrowSide === "end"
        ? arrowStyles.end
        : null;

  const handleVertexPointerDown =
    (vertexIndex: number) => (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        !isSelectable ||
        !isSelected ||
        event.button !== 0 ||
        pinchGestureActiveRef.current
      ) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      try {
        event.currentTarget.focus({ preventScroll: true });
      } catch {
        // ignore
      }
      if (event.pointerType === "touch") {
        pendingTouchVertexDragRef.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          vertexIndex,
        };
        return;
      }
      onTriggerHistorySave?.();
      vertexDragIndexRef.current = vertexIndex;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
        activeVertexPointerRef.current = {
          pointerId: event.pointerId,
          element: event.currentTarget,
        };
      } catch {
        // ignore
      }
    };

  const handleVertexPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (pinchGestureActiveRef.current) return;
    const pendingTouchVertexDrag = pendingTouchVertexDragRef.current;
    if (
      pendingTouchVertexDrag &&
      pendingTouchVertexDrag.pointerId === event.pointerId
    ) {
      const dx = event.clientX - pendingTouchVertexDrag.clientX;
      const dy = event.clientY - pendingTouchVertexDrag.clientY;
      if (Math.hypot(dx, dy) < 8) {
        return;
      }
      pendingTouchVertexDragRef.current = null;
      onTriggerHistorySave?.();
      vertexDragIndexRef.current = pendingTouchVertexDrag.vertexIndex;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
        activeVertexPointerRef.current = {
          pointerId: event.pointerId,
          element: event.currentTarget,
        };
      } catch {
        // ignore
      }
    }
    const vertexIndex = vertexDragIndexRef.current;
    if (vertexIndex === null) return;
    event.stopPropagation();
    event.preventDefault();
    const rawNextPoint = getAbsolutePointFromClientPosition(
      event.clientX,
      event.clientY,
    );
    let nextPoint = rawNextPoint;

    if (event.shiftKey && (isOpenLineShape || isClosedShapeType(shapeType))) {
      if (isClosedShapeType(shapeType) && absolutePoints.length >= 3) {
        const previousAnchor =
          vertexIndex === 0
            ? (absolutePoints[absolutePoints.length - 1] ?? null)
            : (absolutePoints[vertexIndex - 1] ?? null);
        const nextAnchor =
          absolutePoints[(vertexIndex + 1) % absolutePoints.length] ?? null;

        if (previousAnchor && nextAnchor) {
          nextPoint = snapShapePointBetweenAnchors(
            previousAnchor,
            nextAnchor,
            rawNextPoint,
            15,
          );
        }
      } else {
        const anchorPoint =
          vertexIndex === 0
            ? (absolutePoints[1] ?? null)
            : (absolutePoints[vertexIndex - 1] ?? null);
        if (
          anchorPoint &&
          !(
            anchorPoint.x === rawNextPoint.x && anchorPoint.y === rawNextPoint.y
          )
        ) {
          nextPoint = snapShapePointToAngle(anchorPoint, rawNextPoint, 15);
        }
      }
    }

    const nextPoints = absolutePoints.map((point, index) =>
      index === vertexIndex ? nextPoint : point,
    );
    commitAbsolutePoints(nextPoints);
  };

  const handleVertexPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const pendingTouchVertexDrag = pendingTouchVertexDragRef.current;
    if (
      pendingTouchVertexDrag &&
      pendingTouchVertexDrag.pointerId === event.pointerId
    ) {
      pendingTouchVertexDragRef.current = null;
    }
    if (vertexDragIndexRef.current === null) return;
    event.stopPropagation();
    event.preventDefault();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    vertexDragIndexRef.current = null;
    activeVertexPointerRef.current = null;
  };

  const handleVertexKeyDown =
    (vertexIndex: number) => (event: React.KeyboardEvent<HTMLDivElement>) => {
      let direction: MoveDirection;
      if (event.key === "ArrowUp") direction = "UP";
      else if (event.key === "ArrowDown") direction = "DOWN";
      else if (event.key === "ArrowLeft") direction = "LEFT";
      else if (event.key === "ArrowRight") direction = "RIGHT";
      else return;

      event.preventDefault();
      event.stopPropagation();

      if (!event.repeat) {
        onTriggerHistorySave?.();
      }

      const { dx, dy } = getMoveDelta(direction, event.shiftKey);
      const nextPoints = absolutePoints.map((point, index) =>
        index === vertexIndex
          ? {
              x: point.x + dx,
              y: point.y + dy,
            }
          : point,
      );
      commitAbsolutePoints(nextPoints);
    };

  const canEditShapePoints =
    isSelectable &&
    isAnnotationMode &&
    isSelected &&
    shapeSupportsVertexInsertion(shapeType);
  const canShowLayerContextMenu = isSelectable;

  const contextMenuContent = (
    <>
      {shapeSupportsVertexInsertion(shapeType) &&
        contextState.segmentIndex !== null &&
        contextState.point && (
          <ContextMenuItem
            onSelect={() => {
              onTriggerHistorySave?.();
              const nextPoints = insertShapePointAtSegment(
                absolutePoints,
                contextState.segmentIndex!,
                contextState.point!,
              );
              commitAbsolutePoints(
                nextPoints,
                getShapeTypeAfterPointInsertion(shapeType),
              );
            }}
          >
            {t("properties.insert_point") || "Insert Point"}
          </ContextMenuItem>
        )}
      {isOpenLineShape && endpointVertexIndex !== null && endpointArrowSide && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            {t("properties.arrow_style") || "Arrow Style"}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={endpointArrowStyle ?? "none"}
              onValueChange={(value) => {
                onTriggerHistorySave?.();
                const nextStyles = {
                  ...arrowStyles,
                  [endpointArrowSide]:
                    value === "none" ? null : (value as ShapeArrowStyle),
                };
                commitAbsolutePoints(
                  absolutePoints,
                  nextStyles.start || nextStyles.end
                    ? "arrow"
                    : getShapeTypeWithoutArrow(absolutePoints.length),
                  {
                    arrowSize,
                    ...getShapeArrowStyleUpdates(nextStyles),
                  },
                );
              }}
            >
              <ContextMenuRadioItem value="none">
                {t("properties.none") || "None"}
              </ContextMenuRadioItem>
              {SHAPE_ARROW_STYLE_OPTIONS.map((style) => (
                <ContextMenuRadioItem key={style} value={style}>
                  {t(`properties.arrow_style_${style}`) ||
                    {
                      closed_arrow: "Closed Arrow",
                      line_arrow: "Line Arrow",
                      hollow_arrow: "Hollow Arrow",
                      circle: "Circle",
                      square: "Square",
                      diamond: "Diamond",
                      slash: "Slash",
                    }[style]}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      {shapeSupportsVertexInsertion(shapeType) &&
        contextState.vertexIndex !== null &&
        absolutePoints.length > getShapeMinimumPointCount(shapeType) && (
          <ContextMenuItem
            onSelect={() => {
              onTriggerHistorySave?.();
              const removedIndex = contextState.vertexIndex!;
              const nextPoints = removeShapePoint(absolutePoints, removedIndex);
              const nextStyles = {
                start:
                  isOpenLineShape && removedIndex === 0
                    ? null
                    : arrowStyles.start,
                end:
                  isOpenLineShape && removedIndex === absolutePoints.length - 1
                    ? null
                    : arrowStyles.end,
              };
              commitAbsolutePoints(
                nextPoints,
                isOpenLineShape
                  ? nextStyles.start || nextStyles.end
                    ? "arrow"
                    : getShapeTypeWithoutArrow(nextPoints.length)
                  : getShapeTypeAfterPointDeletion(
                      shapeType,
                      nextPoints.length,
                    ),
                {
                  arrowSize,
                  ...getShapeArrowStyleUpdates(nextStyles),
                },
              );
            }}
          >
            {t("properties.delete_point") || "Delete Point"}
          </ContextMenuItem>
        )}
      {canShowLayerContextMenu && props.onReorderLayer && (
        <>
          {shapeSupportsVertexInsertion(shapeType) &&
            (contextState.segmentIndex !== null ||
              contextState.vertexIndex !== null) && <ContextMenuSeparator />}
          <ControlLayerMenuItems
            onSelect={(move) => props.onReorderLayer?.(data.id, move)}
          />
        </>
      )}
    </>
  );

  const openContextMenu = (
    clientX: number,
    clientY: number,
    nextState: {
      point: { x: number; y: number } | null;
      segmentIndex: number | null;
      vertexIndex: number | null;
    },
  ) => {
    flushSync(() => {
      setContextState(nextState);
      setMenuAnchor({ x: clientX, y: clientY });
      props.onSelect(data.id);
    });

    requestAnimationFrame(() => {
      const trigger = menuTriggerRef.current;
      if (!trigger) return;
      trigger.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          button: 2,
        }),
      );
    });
  };

  const handleSegmentContextMenu =
    (segmentIndex: number) => (event: React.MouseEvent<SVGPathElement>) => {
      if (!canEditShapePoints) return;
      event.preventDefault();
      event.stopPropagation();
      const point = getAbsolutePointFromClientPosition(
        event.clientX,
        event.clientY,
      );
      openContextMenu(event.clientX, event.clientY, {
        point,
        segmentIndex,
        vertexIndex: null,
      });
    };

  const handleVertexContextMenu =
    (index: number) => (event: React.MouseEvent<HTMLDivElement>) => {
      if (!canEditShapePoints) return;
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(event.clientX, event.clientY, {
        point: {
          x: absolutePoints[index]!.x,
          y: absolutePoints[index]!.y,
        },
        segmentIndex: null,
        vertexIndex: index,
      });
    };

  const handleShapeContextMenu = (
    event: React.MouseEvent<SVGElement | HTMLDivElement>,
  ) => {
    if (!canShowLayerContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    openContextMenu(event.clientX, event.clientY, {
      point: null,
      segmentIndex: null,
      vertexIndex: null,
    });
  };

  const handleSelectionHitPointerDown = (
    event: React.PointerEvent<SVGElement>,
  ) => {
    if (!isSelectable) return;
    if (event.button !== 0 && event.button !== 2) return;
    event.stopPropagation();
    event.preventDefault();
    props.onSelect(data.id);
    if (event.button === 0) {
      props.onPointerDown?.(event);
    }
  };

  const contentHitAreaProps = {
    style: isSelectable ? { cursor: "pointer" } : undefined,
    onContextMenu: handleShapeContextMenu,
    ...tooltipHoverProps,
  };
  const selectionHitAreaProps = {
    onPointerDown: handleSelectionHitPointerDown,
    ...contentHitAreaProps,
  };
  const selectedContextHitAreaProps = {
    onContextMenu: handleShapeContextMenu,
    ...tooltipHoverProps,
  };

  const renderShape = () => {
    switch (data.shapeType) {
      case "square":
        return (
          <rect
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={Math.max(1, data.rect!.width - strokeWidth)}
            height={Math.max(1, data.rect!.height - strokeWidth)}
            fill={hasFill ? fillColor : "none"}
            fillOpacity={hasFill ? fillOpacity : undefined}
            stroke={hasStroke ? strokeColor : "none"}
            strokeOpacity={hasStroke ? strokeOpacity : undefined}
            strokeWidth={hasStroke ? strokeWidth : 0}
            strokeDasharray={strokeDasharray}
            pointerEvents={hasFill ? "all" : "stroke"}
            {...contentHitAreaProps}
          />
        );
      case "circle":
        return (
          <ellipse
            cx={data.rect!.width / 2}
            cy={data.rect!.height / 2}
            rx={Math.max(1, data.rect!.width / 2 - strokeWidth / 2)}
            ry={Math.max(1, data.rect!.height / 2 - strokeWidth / 2)}
            fill={hasFill ? fillColor : "none"}
            fillOpacity={hasFill ? fillOpacity : undefined}
            stroke={hasStroke ? strokeColor : "none"}
            strokeOpacity={hasStroke ? strokeOpacity : undefined}
            strokeWidth={hasStroke ? strokeWidth : 0}
            strokeDasharray={strokeDasharray}
            pointerEvents={hasFill ? "all" : "stroke"}
            {...contentHitAreaProps}
          />
        );
      case "cloud":
        return (
          <path
            d={cloudPath}
            fill={hasFill ? fillColor : "none"}
            fillOpacity={hasFill ? fillOpacity : undefined}
            stroke={hasStroke ? strokeColor : "none"}
            strokeOpacity={hasStroke ? strokeOpacity : undefined}
            strokeWidth={hasStroke ? strokeWidth : 0}
            strokeDasharray={strokeDasharray}
            pointerEvents={hasFill ? "all" : "stroke"}
            {...contentHitAreaProps}
          />
        );
      case "line":
      case "polyline":
        return (
          <path
            d={polyPath}
            fill="none"
            stroke={hasStroke ? strokeColor : "none"}
            strokeOpacity={hasStroke ? strokeOpacity : undefined}
            strokeWidth={hasStroke ? strokeWidth : 0}
            strokeDasharray={strokeDasharray}
            strokeLinejoin={strokeLinejoin}
            strokeLinecap={strokeLinecap}
            pointerEvents="stroke"
            {...contentHitAreaProps}
          />
        );
      case "polygon":
        return (
          <path
            d={polyPath}
            fill={hasFill ? fillColor : "none"}
            fillOpacity={hasFill ? fillOpacity : undefined}
            stroke={hasStroke ? strokeColor : "none"}
            strokeOpacity={hasStroke ? strokeOpacity : undefined}
            strokeWidth={hasStroke ? strokeWidth : 0}
            strokeDasharray={strokeDasharray}
            strokeLinejoin={strokeLinejoin}
            strokeLinecap={strokeLinecap}
            pointerEvents={hasFill ? "all" : "stroke"}
            {...contentHitAreaProps}
          />
        );
      case "cloud_polygon":
        return (
          <path
            d={cloudPolygonPath}
            fill={hasFill ? fillColor : "none"}
            fillOpacity={hasFill ? fillOpacity : undefined}
            stroke={hasStroke ? strokeColor : "none"}
            strokeOpacity={hasStroke ? strokeOpacity : undefined}
            strokeWidth={hasStroke ? strokeWidth : 0}
            strokeDasharray={strokeDasharray}
            strokeLinejoin={strokeLinejoin}
            strokeLinecap={strokeLinecap}
            pointerEvents={hasFill ? "all" : "stroke"}
            {...contentHitAreaProps}
          />
        );
      case "arrow":
        return (
          <>
            <path
              d={polyPath}
              fill="none"
              stroke={hasStroke ? strokeColor : "none"}
              strokeOpacity={hasStroke ? strokeOpacity : undefined}
              strokeWidth={hasStroke ? strokeWidth : 0}
              strokeDasharray={strokeDasharray}
              strokeLinejoin={strokeLinejoin}
              strokeLinecap={strokeLinecap}
              pointerEvents="stroke"
              {...contentHitAreaProps}
            />
            {startArrowMarker && (
              <path
                d={startArrowMarker.pathData}
                fill={
                  hasStroke && startArrowMarker.fillMode === "stroke"
                    ? strokeColor
                    : "none"
                }
                fillOpacity={hasStroke ? strokeOpacity : undefined}
                stroke={hasStroke ? strokeColor : "none"}
                strokeOpacity={hasStroke ? strokeOpacity : undefined}
                strokeWidth={hasStroke ? Math.max(1, strokeWidth * 0.9) : 0}
                strokeDasharray={strokeDasharray}
                strokeLinejoin={startArrowStrokeLinejoin}
                strokeLinecap={startArrowStrokeLinecap}
                pointerEvents="all"
                {...contentHitAreaProps}
              />
            )}
            {endArrowMarker && (
              <path
                d={endArrowMarker.pathData}
                fill={
                  hasStroke && endArrowMarker.fillMode === "stroke"
                    ? strokeColor
                    : "none"
                }
                fillOpacity={hasStroke ? strokeOpacity : undefined}
                stroke={hasStroke ? strokeColor : "none"}
                strokeOpacity={hasStroke ? strokeOpacity : undefined}
                strokeWidth={hasStroke ? Math.max(1, strokeWidth * 0.9) : 0}
                strokeDasharray={strokeDasharray}
                strokeLinejoin={endArrowStrokeLinejoin}
                strokeLinecap={endArrowStrokeLinecap}
                pointerEvents="all"
                {...contentHitAreaProps}
              />
            )}
          </>
        );
      default:
        return null;
    }
  };

  const renderSelectionHitArea = () => {
    switch (data.shapeType) {
      case "square":
        return (
          <rect
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={Math.max(1, data.rect!.width - strokeWidth)}
            height={Math.max(1, data.rect!.height - strokeWidth)}
            fill={hasFill ? HIT_TEST_PAINT : "none"}
            fillOpacity={hasFill ? 1 : undefined}
            stroke={HIT_TEST_PAINT}
            strokeWidth={segmentHitWidth}
            vectorEffect="non-scaling-stroke"
            pointerEvents={hasFill ? "all" : "stroke"}
            {...selectionHitAreaProps}
          />
        );
      case "circle":
        return (
          <ellipse
            cx={data.rect!.width / 2}
            cy={data.rect!.height / 2}
            rx={Math.max(1, data.rect!.width / 2 - strokeWidth / 2)}
            ry={Math.max(1, data.rect!.height / 2 - strokeWidth / 2)}
            fill={hasFill ? HIT_TEST_PAINT : "none"}
            fillOpacity={hasFill ? 1 : undefined}
            stroke={HIT_TEST_PAINT}
            strokeWidth={segmentHitWidth}
            vectorEffect="non-scaling-stroke"
            pointerEvents={hasFill ? "all" : "stroke"}
            {...selectionHitAreaProps}
          />
        );
      case "cloud":
        return (
          <path
            d={cloudPath}
            fill={hasFill ? HIT_TEST_PAINT : "none"}
            fillOpacity={hasFill ? 1 : undefined}
            stroke={HIT_TEST_PAINT}
            strokeWidth={segmentHitWidth}
            strokeLinejoin={strokeLinejoin}
            strokeLinecap={strokeLinecap}
            vectorEffect="non-scaling-stroke"
            pointerEvents={hasFill ? "all" : "stroke"}
            {...selectionHitAreaProps}
          />
        );
      case "line":
      case "polyline":
        return (
          <path
            d={polyPath}
            fill="none"
            stroke={HIT_TEST_PAINT}
            strokeWidth={segmentHitWidth}
            strokeLinejoin={strokeLinejoin}
            strokeLinecap={strokeLinecap}
            vectorEffect="non-scaling-stroke"
            pointerEvents="stroke"
            {...selectionHitAreaProps}
          />
        );
      case "polygon":
        return (
          <path
            d={polyPath}
            fill={hasFill ? HIT_TEST_PAINT : "none"}
            fillOpacity={hasFill ? 1 : undefined}
            stroke={HIT_TEST_PAINT}
            strokeWidth={segmentHitWidth}
            strokeLinejoin={strokeLinejoin}
            strokeLinecap={strokeLinecap}
            vectorEffect="non-scaling-stroke"
            pointerEvents={hasFill ? "all" : "stroke"}
            {...selectionHitAreaProps}
          />
        );
      case "cloud_polygon":
        return hasFill ? (
          <path
            d={cloudPolygonPath}
            fill={HIT_TEST_PAINT}
            fillOpacity={1}
            stroke={HIT_TEST_PAINT}
            strokeWidth={segmentHitWidth}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            pointerEvents="all"
            {...selectionHitAreaProps}
          />
        ) : (
          <>
            {cloudPolygonSelectionSegments.map((segmentPath, index) => (
              <path
                key={`${data.id}_cloud_hit_${index}`}
                d={segmentPath}
                fill="none"
                stroke={HIT_TEST_PAINT}
                strokeWidth={segmentHitWidth}
                strokeLinejoin="round"
                strokeLinecap="butt"
                vectorEffect="non-scaling-stroke"
                pointerEvents="stroke"
                {...selectionHitAreaProps}
              />
            ))}
          </>
        );
      case "arrow":
        return (
          <>
            <path
              d={polyPath}
              fill="none"
              stroke={HIT_TEST_PAINT}
              strokeWidth={segmentHitWidth}
              strokeLinejoin={strokeLinejoin}
              strokeLinecap={strokeLinecap}
              vectorEffect="non-scaling-stroke"
              pointerEvents="stroke"
              {...selectionHitAreaProps}
            />
            {startArrowMarker && (
              <path
                d={startArrowMarker.pathData}
                fill={HIT_TEST_PAINT}
                stroke={HIT_TEST_PAINT}
                strokeWidth={Math.max(6, segmentHitWidth * 0.75)}
                strokeLinejoin={startArrowStrokeLinejoin}
                strokeLinecap={startArrowStrokeLinecap}
                vectorEffect="non-scaling-stroke"
                pointerEvents="all"
                {...selectionHitAreaProps}
              />
            )}
            {endArrowMarker && (
              <path
                d={endArrowMarker.pathData}
                fill={HIT_TEST_PAINT}
                stroke={HIT_TEST_PAINT}
                strokeWidth={Math.max(6, segmentHitWidth * 0.75)}
                strokeLinejoin={endArrowStrokeLinejoin}
                strokeLinecap={endArrowStrokeLinecap}
                vectorEffect="non-scaling-stroke"
                pointerEvents="all"
                {...selectionHitAreaProps}
              />
            )}
          </>
        );
      default:
        return null;
    }
  };

  return (
    <ControlWrapper
      {...props}
      customRect={rotatedOuterRect}
      showBorder={isSelected}
      resizable={!hasVertices}
      contextMenuDisabled={true}
      className={!isSelected ? "pointer-events-none" : undefined}
    >
      <FloatingToolbar isVisible={isSelected} sideOffset={32}>
        <ColorPickerPopover
          paletteType="foreground"
          color={strokeColor}
          thickness={strokeWidth}
          minThickness={0}
          opacity={strokeOpacity}
          onInteractionStart={onTriggerHistorySave}
          onColorChange={(color) =>
            onUpdate(data.id, {
              color,
              appearanceStreamContent: undefined,
            })
          }
          onThicknessChange={(thickness) =>
            onUpdate(data.id, {
              thickness,
              appearanceStreamContent: undefined,
            })
          }
          onOpacityChange={(nextOpacity) =>
            onUpdate(data.id, {
              opacity: nextOpacity,
              appearanceStreamContent: undefined,
            })
          }
          extraContent={
            <ShapeBorderStyleSection
              value={borderStyle}
              dashDensity={dashDensity}
              onInteractionStart={onTriggerHistorySave}
              onChange={(nextBorderStyle) =>
                onUpdate(data.id, {
                  borderStyle: nextBorderStyle,
                  appearanceStreamContent: undefined,
                })
              }
              onDashDensityChange={(nextDashDensity) =>
                onUpdate(data.id, {
                  dashDensity: nextDashDensity,
                  appearanceStreamContent: undefined,
                })
              }
            />
          }
          isActive={isSelected}
          side="top"
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            style={{ backgroundColor: getContrastColor(strokeColor) }}
          >
            <Palette size={16} style={{ color: strokeColor }} />
          </Button>
        </ColorPickerPopover>

        <AnnotationAskAiButton annotation={data} onAskAi={onAskAi} />

        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
          onClick={() => onDelete?.(data.id)}
        >
          <Trash2 size={16} />
        </Button>
      </FloatingToolbar>

      <Tooltip
        open={tooltipText ? isTooltipOpen : false}
        onOpenChange={setIsTooltipOpen}
        delayDuration={0}
        disableHoverableContent
      >
        <TooltipTrigger asChild>
          <div
            className="h-full w-full"
            onPointerDownCapture={(event) => {
              if (event.button !== 0) return;
              if (isContextMenuContentTarget(event.target)) return;
              if (!contextMenuOpenRef.current) return;
              event.preventDefault();
              event.stopPropagation();
              dismissContextMenu();
            }}
          >
            <ContextMenu
              modal={false}
              onOpenChange={(open) => {
                contextMenuOpenRef.current = open;
                if (!open) {
                  resetContextState();
                }
              }}
            >
              <ContextMenuTrigger asChild>
                <div
                  ref={menuTriggerRef}
                  aria-hidden="true"
                  className="pointer-events-none fixed h-px w-px"
                  style={{ left: menuAnchor.x, top: menuAnchor.y }}
                />
              </ContextMenuTrigger>
              <ContextMenuContent
                className="z-50 min-w-40"
                onPointerDown={(e) => e.stopPropagation()}
              >
                {contextMenuContent}
              </ContextMenuContent>

              <div
                className={
                  rotationDeg !== 0
                    ? "absolute top-1/2 left-1/2"
                    : "relative h-full w-full"
                }
                style={
                  rotationDeg !== 0
                    ? {
                        width: `calc(${data.rect.width}px * var(--scale, 1))`,
                        height: `calc(${data.rect.height}px * var(--scale, 1))`,
                        transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)`,
                        transformOrigin: "50% 50%",
                      }
                    : undefined
                }
              >
                <div className="relative h-full w-full">
                  <svg
                    ref={setSvgRefs}
                    width="100%"
                    height="100%"
                    className="overflow-visible"
                    viewBox={`0 0 ${Math.max(1, data.rect.width)} ${Math.max(1, data.rect.height)}`}
                  >
                    {renderShape()}

                    {!isSelected && renderSelectionHitArea()}

                    {isSelected && (
                      <rect
                        x={0}
                        y={0}
                        width={Math.max(1, data.rect.width)}
                        height={Math.max(1, data.rect.height)}
                        fill={HIT_TEST_PAINT}
                        pointerEvents="all"
                        {...selectedContextHitAreaProps}
                      />
                    )}

                    {canEditShapePoints &&
                      segmentTargets.map((segment) => (
                        <path
                          key={`${data.id}_segment_${segment.index}`}
                          d={segment.d}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={segmentHitWidth}
                          strokeLinecap={strokeLinecap}
                          strokeLinejoin={strokeLinejoin}
                          vectorEffect="non-scaling-stroke"
                          pointerEvents="stroke"
                          onContextMenu={handleSegmentContextMenu(
                            segment.index,
                          )}
                          onMouseEnter={
                            tooltipText
                              ? () => setIsTooltipOpen(true)
                              : undefined
                          }
                          onMouseLeave={
                            tooltipText
                              ? () => setIsTooltipOpen(false)
                              : undefined
                          }
                        />
                      ))}
                  </svg>

                  {isSelected &&
                    hasVertices &&
                    localPoints.map((point, index) => {
                      return (
                        <div
                          key={`${data.id}_vertex_${index}`}
                          className="pointer-events-auto absolute h-3 w-3 cursor-move rounded-full border border-blue-500 bg-white"
                          tabIndex={0}
                          data-app-keyboard-handle="shape-vertex"
                          aria-label={`${shapeType} point ${index + 1}`}
                          style={{
                            left: `${(point.x / Math.max(1, rect.width)) * 100}%`,
                            top: `${(point.y / Math.max(1, rect.height)) * 100}%`,
                            transform: "translate(-50%, -50%)",
                            zIndex: 60,
                          }}
                          onPointerDown={handleVertexPointerDown(index)}
                          onPointerMove={handleVertexPointerMove}
                          onPointerUp={handleVertexPointerUp}
                          onPointerCancel={handleVertexPointerUp}
                          onKeyDown={handleVertexKeyDown(index)}
                          onContextMenu={
                            canEditShapePoints
                              ? handleVertexContextMenu(index)
                              : undefined
                          }
                        />
                      );
                    })}
                </div>
              </div>
            </ContextMenu>
          </div>
        </TooltipTrigger>

        {tooltipText && (
          <TooltipPrimitive.Portal>
            <TooltipPrimitive.Content
              align="center"
              side="bottom"
              sideOffset={36}
              hideWhenDetached
              className="group z-50"
              style={{
                transform: `translate(${hoverX - hoverWidth / 2}px, ${hoverY - hoverHeight}px)`,
              }}
            >
              <div className="bg-background text-foreground pointer-events-none max-w-xs rounded-md px-2 py-1 text-xs wrap-break-word whitespace-pre-wrap opacity-80 shadow-sm">
                {tooltipText}
              </div>
            </TooltipPrimitive.Content>
          </TooltipPrimitive.Portal>
        )}
      </Tooltip>
    </ControlWrapper>
  );
};
