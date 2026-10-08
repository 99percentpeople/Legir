import {
  CheckSquare,
  CircleDot,
  Eraser,
  Hand,
  Highlighter,
  List,
  MessageCircle,
  MousePointer2,
  PenLine,
  Stamp,
  TextSelect,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { EditorState, Tool } from "@/types";
import { canUseToolWithPdfPermissions } from "@/lib/pdfPermissions";
import { getShapeToolIcon, type ShapeTool } from "./shapeTools";

type ToolDefinition = {
  Icon: LucideIcon;
  labelKey: string;
  style:
    | "none"
    | "pen"
    | "highlight"
    | "comment"
    | "freetext"
    | "shape"
    | "stamp";
};

const shape = (tool: ShapeTool, labelKey: string): ToolDefinition => ({
  Icon: getShapeToolIcon(tool),
  labelKey,
  style: "shape",
});

// Exhaustive: every tool shares the same identity, options and exit affordance.
export const TOOL_DEFINITIONS: Record<Tool, ToolDefinition> = {
  select: { Icon: MousePointer2, labelKey: "toolbar.select", style: "none" },
  select_text: {
    Icon: TextSelect,
    labelKey: "toolbar.select_text",
    style: "none",
  },
  pan: { Icon: Hand, labelKey: "toolbar.pan", style: "none" },
  eraser: { Icon: Eraser, labelKey: "toolbar.eraser", style: "none" },
  draw_text: { Icon: Type, labelKey: "toolbar.text", style: "none" },
  draw_checkbox: {
    Icon: CheckSquare,
    labelKey: "toolbar.checkbox",
    style: "none",
  },
  draw_radio: { Icon: CircleDot, labelKey: "toolbar.radio", style: "none" },
  draw_dropdown: { Icon: List, labelKey: "toolbar.dropdown", style: "none" },
  draw_signature: {
    Icon: PenLine,
    labelKey: "toolbar.signature",
    style: "none",
  },
  draw_highlight: {
    Icon: Highlighter,
    labelKey: "toolbar.highlight_text",
    style: "highlight",
  },
  draw_ink: { Icon: PenLine, labelKey: "toolbar.ink", style: "pen" },
  draw_comment: {
    Icon: MessageCircle,
    labelKey: "toolbar.comment",
    style: "comment",
  },
  draw_freetext: {
    Icon: Type,
    labelKey: "toolbar.freetext",
    style: "freetext",
  },
  draw_stamp: { Icon: Stamp, labelKey: "toolbar.stamp", style: "stamp" },
  draw_shape_rect: shape("draw_shape_rect", "toolbar.square"),
  draw_shape_ellipse: shape("draw_shape_ellipse", "toolbar.circle"),
  draw_shape_line: shape("draw_shape_line", "toolbar.line"),
  draw_shape_polyline: shape("draw_shape_polyline", "toolbar.polyline"),
  draw_shape_polygon: shape("draw_shape_polygon", "toolbar.polygon"),
  draw_shape_cloud_polygon: shape(
    "draw_shape_cloud_polygon",
    "toolbar.cloud_polygon",
  ),
  draw_shape_arrow: shape("draw_shape_arrow", "toolbar.arrow"),
  draw_shape_cloud: shape("draw_shape_cloud", "toolbar.cloud"),
};

export const ANNOTATION_TOOLS: Tool[] = [
  "eraser",
  "draw_highlight",
  "draw_ink",
  "draw_comment",
  "draw_freetext",
  "draw_stamp",
];
export const FORM_TOOLS: Tool[] = [
  "draw_text",
  "draw_checkbox",
  "draw_radio",
  "draw_dropdown",
  "draw_signature",
];

export function isToolbarToolAllowed(
  tool: Tool,
  state: Pick<
    EditorState,
    "documentLoadState" | "documentPermissions" | "mode"
  >,
) {
  return (
    (state.documentLoadState === "ready" ||
      tool === "pan" ||
      tool === "select_text") &&
    canUseToolWithPdfPermissions(tool, state.mode, state.documentPermissions)
  );
}
