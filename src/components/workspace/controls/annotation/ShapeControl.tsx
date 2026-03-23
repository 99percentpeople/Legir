import React, { useCallback, useMemo, useRef, useState } from "react";
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
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useMouse } from "@/hooks/useMouse";
import {
  getDefaultArrowSize,
  getLineEndingMarker,
  getShapeArrowStyles,
  getShapeArrowStyleUpdates,
  getShapeTypeAfterPointDeletion,
  getShapeTypeAfterPointInsertion,
  getShapeTypeWithoutArrow,
  getCloudGeometry,
  getCloudPathData,
  getPolygonCloudPathData,
  getRectAndNormalizedShapePoints,
  getShapeAbsolutePoints,
  isClosedShapeType,
  getShapeMinimumPointCount,
  getShapePointsPathData,
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
import { ControlWrapper } from "../ControlWrapper";
import type { AnnotationControlProps } from "../types";
import { AnnotationAskAiButton } from "./AnnotationAskAiButton";

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

  const strokeColor = data.color || "#000000";
  const strokeWidth =
    typeof data.thickness === "number" && Number.isFinite(data.thickness)
      ? Math.max(0, data.thickness)
      : 2;
  const opacity =
    typeof data.opacity === "number" && Number.isFinite(data.opacity)
      ? Math.max(0, Math.min(1, data.opacity))
      : 1;
  const fillColor = data.backgroundColor || "none";
  const hasStroke = opacity > 0 && strokeWidth > 0;
  const hasFill = opacity > 0 && fillColor !== "none";
  const segmentHitWidth = Math.max(12, strokeWidth * 4);
  const hasVertices = shapeSupportsVertices(data.shapeType);
  const isOpenLineShape = isOpenLineShapeType(data.shapeType);
  const arrowStyles = useMemo(
    () => getShapeArrowStyles(data),
    [
      data.shapeEndArrow,
      data.shapeEndArrowStyle,
      data.shapeStartArrow,
      data.shapeStartArrowStyle,
      data.shapeType,
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
        x: point.x - data.rect!.x,
        y: point.y - data.rect!.y,
      })),
    [absolutePoints, data.rect],
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
  const cloudPolygonPath = useMemo(() => {
    if (data.shapeType !== "cloud_polygon") return "";
    return getPolygonCloudPathData(
      localPoints,
      data.cloudIntensity,
      data.cloudSpacing,
      strokeWidth,
    );
  }, [
    data.cloudIntensity,
    data.cloudSpacing,
    data.shapeType,
    localPoints,
    strokeWidth,
  ]);

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
  const [menuAnchor, setMenuAnchor] = useState({ x: 0, y: 0 });
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const tooltipText = data.text?.trim() || "";

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
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) {
      return {
        x: data.rect!.x,
        y: data.rect!.y,
      };
    }
    const localX =
      ((clientX - bounds.left) / Math.max(1, bounds.width)) * data.rect!.width;
    const localY =
      ((clientY - bounds.top) / Math.max(1, bounds.height)) * data.rect!.height;
    return {
      x: data.rect!.x + localX,
      y: data.rect!.y + localY,
    };
  };

  const commitAbsolutePoints = (
    points: { x: number; y: number }[],
    nextShapeType: NonNullable<typeof data.shapeType> = data.shapeType,
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
      data.shapeType,
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
      if (!isSelectable || !isSelected || event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      try {
        event.currentTarget.focus({ preventScroll: true });
      } catch {
        // ignore
      }
      onTriggerHistorySave?.();
      vertexDragIndexRef.current = vertexIndex;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    };

  const handleVertexPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const vertexIndex = vertexDragIndexRef.current;
    if (vertexIndex === null) return;
    event.stopPropagation();
    event.preventDefault();
    const rawNextPoint = getAbsolutePointFromClientPosition(
      event.clientX,
      event.clientY,
    );
    let nextPoint = rawNextPoint;

    const anchorPoint =
      event.shiftKey && (isOpenLineShape || isClosedShapeType(data.shapeType))
        ? vertexIndex === 0
          ? isClosedShapeType(data.shapeType)
            ? (absolutePoints[absolutePoints.length - 1] ?? null)
            : (absolutePoints[1] ?? null)
          : (absolutePoints[vertexIndex - 1] ?? null)
        : null;
    if (
      anchorPoint &&
      !(anchorPoint.x === rawNextPoint.x && anchorPoint.y === rawNextPoint.y)
    ) {
      nextPoint = snapShapePointToAngle(anchorPoint, rawNextPoint, 15);
    }

    const nextPoints = absolutePoints.map((point, index) =>
      index === vertexIndex ? nextPoint : point,
    );
    commitAbsolutePoints(nextPoints);
  };

  const handleVertexPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (vertexDragIndexRef.current === null) return;
    event.stopPropagation();
    event.preventDefault();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    vertexDragIndexRef.current = null;
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
    shapeSupportsVertexInsertion(data.shapeType);
  const canShowLayerContextMenu = isSelectable && isAnnotationMode;

  const contextMenuContent = (
    <>
      {shapeSupportsVertexInsertion(data.shapeType) &&
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
                getShapeTypeAfterPointInsertion(data.shapeType),
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
      {shapeSupportsVertexInsertion(data.shapeType) &&
        contextState.vertexIndex !== null &&
        absolutePoints.length > getShapeMinimumPointCount(data.shapeType) && (
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
                      data.shapeType,
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
          {shapeSupportsVertexInsertion(data.shapeType) &&
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
            stroke={hasStroke ? strokeColor : "none"}
            strokeWidth={hasStroke ? strokeWidth : 0}
            pointerEvents="all"
            onContextMenu={handleShapeContextMenu}
            {...tooltipHoverProps}
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
            stroke={hasStroke ? strokeColor : "none"}
            strokeWidth={hasStroke ? strokeWidth : 0}
            pointerEvents="all"
            onContextMenu={handleShapeContextMenu}
            {...tooltipHoverProps}
          />
        );
      case "cloud":
        return (
          <path
            d={cloudPath}
            fill="none"
            stroke={hasStroke ? strokeColor : "none"}
            strokeWidth={hasStroke ? strokeWidth : 0}
            pointerEvents="all"
            onContextMenu={handleShapeContextMenu}
            {...tooltipHoverProps}
          />
        );
      case "line":
      case "polyline":
        return (
          <path
            d={polyPath}
            fill="none"
            stroke={hasStroke ? strokeColor : "none"}
            strokeWidth={hasStroke ? strokeWidth : 0}
            strokeLinejoin="round"
            strokeLinecap="round"
            pointerEvents="stroke"
            onContextMenu={handleShapeContextMenu}
            {...tooltipHoverProps}
          />
        );
      case "polygon":
        return (
          <path
            d={polyPath}
            fill={hasFill ? fillColor : "none"}
            stroke={hasStroke ? strokeColor : "none"}
            strokeWidth={hasStroke ? strokeWidth : 0}
            strokeLinejoin="round"
            strokeLinecap="round"
            pointerEvents="all"
            onContextMenu={handleShapeContextMenu}
            {...tooltipHoverProps}
          />
        );
      case "cloud_polygon":
        return (
          <>
            {hasFill && (
              <path
                d={polyPath}
                fill={fillColor}
                stroke="none"
                pointerEvents="all"
                onContextMenu={handleShapeContextMenu}
                {...tooltipHoverProps}
              />
            )}
            <path
              d={cloudPolygonPath}
              fill="none"
              stroke={hasStroke ? strokeColor : "none"}
              strokeWidth={hasStroke ? strokeWidth : 0}
              strokeLinejoin="round"
              strokeLinecap="round"
              pointerEvents="stroke"
              onContextMenu={handleShapeContextMenu}
              {...tooltipHoverProps}
            />
          </>
        );
      case "arrow":
        return (
          <>
            <path
              d={polyPath}
              fill="none"
              stroke={hasStroke ? strokeColor : "none"}
              strokeWidth={hasStroke ? strokeWidth : 0}
              strokeLinejoin="round"
              strokeLinecap="round"
              pointerEvents="stroke"
              onContextMenu={handleShapeContextMenu}
              {...tooltipHoverProps}
            />
            {startArrowMarker && (
              <path
                d={startArrowMarker.pathData}
                fill={
                  hasStroke && startArrowMarker.fillMode === "stroke"
                    ? strokeColor
                    : "none"
                }
                stroke={hasStroke ? strokeColor : "none"}
                strokeWidth={hasStroke ? Math.max(1, strokeWidth * 0.9) : 0}
                strokeLinejoin="round"
                strokeLinecap="round"
                pointerEvents="all"
                onContextMenu={handleShapeContextMenu}
                {...tooltipHoverProps}
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
                stroke={hasStroke ? strokeColor : "none"}
                strokeWidth={hasStroke ? Math.max(1, strokeWidth * 0.9) : 0}
                strokeLinejoin="round"
                strokeLinecap="round"
                pointerEvents="all"
                onContextMenu={handleShapeContextMenu}
                {...tooltipHoverProps}
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
      showBorder={isSelected}
      resizable={!hasVertices}
      contextMenuDisabled={true}
    >
      <FloatingToolbar isVisible={isSelected}>
        <ColorPickerPopover
          color={strokeColor}
          thickness={strokeWidth}
          opacity={opacity}
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
          <div className="h-full w-full">
            <ContextMenu modal={false}>
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

              <svg
                ref={setSvgRefs}
                width="100%"
                height="100%"
                className="overflow-visible"
                viewBox={`0 0 ${Math.max(1, data.rect.width)} ${Math.max(1, data.rect.height)}`}
                opacity={opacity}
              >
                {renderShape()}

                {canEditShapePoints &&
                  segmentTargets.map((segment) => (
                    <path
                      key={`${data.id}_segment_${segment.index}`}
                      d={segment.d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={segmentHitWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="stroke"
                      onContextMenu={handleSegmentContextMenu(segment.index)}
                      onMouseEnter={
                        tooltipText ? () => setIsTooltipOpen(true) : undefined
                      }
                      onMouseLeave={
                        tooltipText ? () => setIsTooltipOpen(false) : undefined
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
                      data-ff-keyboard-handle="shape-vertex"
                      aria-label={`${data.shapeType} point ${index + 1}`}
                      style={{
                        left: `${(point.x / Math.max(1, data.rect.width)) * 100}%`,
                        top: `${(point.y / Math.max(1, data.rect.height)) * 100}%`,
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
