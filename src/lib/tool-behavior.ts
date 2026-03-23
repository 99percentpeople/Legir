import { Tool } from "../types";

interface ToolBehavior {
  isContinuous: boolean;
}

const TOOL_BEHAVIORS: Record<Tool, ToolBehavior> = {
  select: { isContinuous: true },
  pan: { isContinuous: true },
  draw_text: { isContinuous: false },
  draw_checkbox: { isContinuous: false },
  draw_radio: { isContinuous: false },
  draw_dropdown: { isContinuous: false },
  draw_signature: { isContinuous: false },
  draw_ink: { isContinuous: true },
  draw_highlight: { isContinuous: true },
  draw_comment: { isContinuous: false },
  draw_freetext: { isContinuous: false },
  draw_shape_rect: { isContinuous: false },
  draw_shape_ellipse: { isContinuous: false },
  draw_shape_line: { isContinuous: false },
  draw_shape_polyline: { isContinuous: true },
  draw_shape_polygon: { isContinuous: true },
  draw_shape_cloud_polygon: { isContinuous: true },
  draw_shape_arrow: { isContinuous: false },
  draw_shape_cloud: { isContinuous: false },
  eraser: { isContinuous: true },
};

export const getToolBehavior = (tool: Tool): ToolBehavior => {
  return TOOL_BEHAVIORS[tool] || { isContinuous: false };
};

export const shouldSwitchToSelectAfterUse = (tool: Tool): boolean => {
  return !getToolBehavior(tool).isContinuous;
};

export const getCursor = (tool: Tool) => {
  switch (tool) {
    case "draw_ink":
      return "crosshair";
    case "eraser":
      return "cell";
    case "select":
      return undefined;
    case "draw_highlight":
    case "draw_comment":
    case "draw_shape_polyline":
    case "draw_shape_polygon":
    case "draw_shape_cloud_polygon":
      return "crosshair";
    default:
      return "crosshair";
  }
};
