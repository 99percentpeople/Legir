import React from "react";
import { Shapes } from "lucide-react";
import { ANNOTATION_STYLES } from "@/constants";
import { useLanguage } from "../language-provider";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import {
  ANNOTATION_TOOLS,
  FORM_TOOLS,
  TOOL_DEFINITIONS,
  isToolbarToolAllowed,
} from "./toolDefinitions";
import { isShapeTool, type ShapeTool } from "./shapeTools";
import type { EditorState, Tool } from "@/types";
import type { ToolOptionsState } from "./types";

export function EditorToolSelector({
  state,
  onToolChange,
}: {
  state: ToolOptionsState &
    Pick<
      EditorState,
      "mode" | "tool" | "documentLoadState" | "documentPermissions"
    >;
  onToolChange: (tool: Tool) => void;
}) {
  const { t } = useLanguage();
  const [lastShape, setLastShape] =
    React.useState<ShapeTool>("draw_shape_rect");
  React.useEffect(() => {
    if (isShapeTool(state.tool)) setLastShape(state.tool);
  }, [state.tool]);
  const activeShape = isShapeTool(state.tool) ? state.tool : lastShape;
  const tools: Tool[] = [
    "pan",
    "select",
    ...(state.mode === "form"
      ? FORM_TOOLS
      : [...ANNOTATION_TOOLS, activeShape]),
  ];
  return (
    <ToggleGroup
      type="single"
      value={state.tool}
      onValueChange={(value) => {
        if (value && isToolbarToolAllowed(value as Tool, state))
          onToolChange(value as Tool);
      }}
      className="sm:bg-muted/20 mx-auto flex min-w-max items-center gap-1 rounded-lg p-1 sm:shadow-sm"
      spacing={1}
    >
      {tools.map((tool) => {
        const definition = TOOL_DEFINITIONS[tool];
        const Icon =
          isShapeTool(tool) && !isShapeTool(state.tool)
            ? Shapes
            : definition.Icon;
        const label = t(
          isShapeTool(tool) && !isShapeTool(state.tool)
            ? "toolbar.shape"
            : definition.labelKey,
        );
        const color =
          definition.style === "pen"
            ? state.penStyle.color
            : definition.style === "highlight"
              ? (state.highlightStyle ?? ANNOTATION_STYLES.highlight).color
              : definition.style === "comment"
                ? (state.commentStyle ?? ANNOTATION_STYLES.comment).color
                : definition.style === "freetext"
                  ? (state.freetextStyle ?? ANNOTATION_STYLES.freetext).color
                  : definition.style === "shape"
                    ? (state.shapeStyle ?? ANNOTATION_STYLES.shape).color
                    : undefined;
        return (
          <ToggleGroupItem
            key={isShapeTool(tool) ? "shape" : tool}
            value={tool}
            title={label}
            aria-label={label}
            disabled={!isToolbarToolAllowed(tool, state)}
            className="relative h-8 w-8 p-0 sm:h-9 sm:w-9"
          >
            <Icon size={18} />
            {color && (
              <span
                aria-hidden="true"
                className="absolute bottom-1 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full"
                style={{ backgroundColor: color }}
              />
            )}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
