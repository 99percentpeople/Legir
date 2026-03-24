import {
  ArrowRight,
  Circle,
  Cloud,
  Minus,
  Pentagon,
  Square,
  Spline,
  type LucideIcon,
} from "lucide-react";

import type { Tool } from "@/types";

export type ShapeTool =
  | "draw_shape_rect"
  | "draw_shape_ellipse"
  | "draw_shape_line"
  | "draw_shape_polyline"
  | "draw_shape_polygon"
  | "draw_shape_cloud_polygon"
  | "draw_shape_arrow"
  | "draw_shape_cloud";

type ShapeToolGroupId = "box" | "path" | "polygon";

type ShapeToolDefinition = {
  tool: ShapeTool;
  labelKey: string;
  Icon: LucideIcon;
  group: ShapeToolGroupId;
};

const SHAPE_TOOL_DEFINITIONS: Record<ShapeTool, ShapeToolDefinition> = {
  draw_shape_rect: {
    tool: "draw_shape_rect",
    labelKey: "toolbar.square",
    Icon: Square,
    group: "box",
  },
  draw_shape_ellipse: {
    tool: "draw_shape_ellipse",
    labelKey: "toolbar.circle",
    Icon: Circle,
    group: "box",
  },
  draw_shape_cloud: {
    tool: "draw_shape_cloud",
    labelKey: "toolbar.cloud",
    Icon: Cloud,
    group: "box",
  },
  draw_shape_line: {
    tool: "draw_shape_line",
    labelKey: "toolbar.line",
    Icon: Minus,
    group: "path",
  },
  draw_shape_polyline: {
    tool: "draw_shape_polyline",
    labelKey: "toolbar.polyline",
    Icon: Spline,
    group: "path",
  },
  draw_shape_polygon: {
    tool: "draw_shape_polygon",
    labelKey: "toolbar.polygon",
    Icon: Pentagon,
    group: "polygon",
  },
  draw_shape_cloud_polygon: {
    tool: "draw_shape_cloud_polygon",
    labelKey: "toolbar.cloud_polygon",
    Icon: Cloud,
    group: "polygon",
  },
  draw_shape_arrow: {
    tool: "draw_shape_arrow",
    labelKey: "toolbar.arrow",
    Icon: ArrowRight,
    group: "path",
  },
};

export const SHAPE_TOOL_GROUPS: ReadonlyArray<{
  id: ShapeToolGroupId;
  labelKey: string;
  tools: ShapeTool[];
  columns: number;
  slotCount?: number;
}> = [
  {
    id: "box",
    labelKey: "toolbar.shape_box_tools",
    tools: ["draw_shape_rect", "draw_shape_ellipse", "draw_shape_cloud"],
    columns: 4,
    slotCount: 4,
  },
  {
    id: "path",
    labelKey: "toolbar.shape_path_tools",
    tools: ["draw_shape_line", "draw_shape_polyline", "draw_shape_arrow"],
    columns: 4,
    slotCount: 4,
  },
  {
    id: "polygon",
    labelKey: "toolbar.shape_polygon_tools",
    tools: ["draw_shape_polygon", "draw_shape_cloud_polygon"],
    columns: 4,
    slotCount: 4,
  },
];

export const isShapeTool = (tool: Tool): tool is ShapeTool =>
  tool in SHAPE_TOOL_DEFINITIONS;

export const getShapeToolIcon = (tool: ShapeTool): LucideIcon =>
  SHAPE_TOOL_DEFINITIONS[tool].Icon;

export const getShapeToolLabel = (
  t: (key: string) => string,
  tool: ShapeTool,
) => t(SHAPE_TOOL_DEFINITIONS[tool].labelKey);
