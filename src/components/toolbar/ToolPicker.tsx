import React from "react";
import { ChevronDown } from "lucide-react";
import { useAppEvent } from "@/hooks/useAppEventBus";
import type { EditorState, Tool } from "@/types";
import { useLanguage } from "../language-provider";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { SHAPE_TOOL_GROUPS } from "./shapeTools";
import {
  ANNOTATION_TOOLS,
  FORM_TOOLS,
  TOOL_DEFINITIONS,
  isToolbarToolAllowed,
} from "./toolDefinitions";

type ToolPickerProps = {
  state: Pick<
    EditorState,
    "tool" | "mode" | "documentLoadState" | "documentPermissions"
  >;
  shapesOnly?: boolean;
  compact?: boolean;
  onToolChange: (tool: Tool) => void;
};

export function ToolPicker({
  state,
  shapesOnly = false,
  compact = false,
  onToolChange,
}: ToolPickerProps) {
  const { t } = useLanguage();
  const [open, setOpen] = React.useState(false);
  useAppEvent("workspace:pointerDown", () => setOpen(false));
  const { Icon, labelKey } = TOOL_DEFINITIONS[state.tool];
  const item = (tool: Tool) => {
    const definition = TOOL_DEFINITIONS[tool];
    return (
      <DropdownMenuRadioItem
        key={tool}
        value={tool}
        disabled={!isToolbarToolAllowed(tool, state)}
      >
        <definition.Icon size={16} />
        {t(definition.labelKey)}
      </DropdownMenuRadioItem>
    );
  };
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={
            compact ? "h-8 w-11 gap-1 px-1" : "h-8 max-w-40 gap-1.5 px-2"
          }
          title={t(labelKey)}
          aria-label={t(labelKey)}
        >
          <Icon size={16} />
          {!compact && <span className="max-w-28 truncate">{t(labelKey)}</span>}
          <ChevronDown size={12} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="center"
        sideOffset={12}
        className="min-w-48"
        data-app-block-modifier-wheel-zoom="1"
      >
        <DropdownMenuRadioGroup
          value={state.tool}
          onValueChange={(value) => {
            const tool = value as Tool;
            if (isToolbarToolAllowed(tool, state)) onToolChange(tool);
          }}
        >
          {!shapesOnly && (
            <>
              {(["select", "select_text", "pan"] as Tool[]).map(item)}
              <DropdownMenuSeparator />
              {(state.mode === "form" ? FORM_TOOLS : ANNOTATION_TOOLS).map(
                item,
              )}
            </>
          )}
          {(shapesOnly || state.mode === "annotation") &&
            SHAPE_TOOL_GROUPS.map((group, index) => (
              <React.Fragment key={group.id}>
                {(!shapesOnly || index > 0) && <DropdownMenuSeparator />}
                <DropdownMenuLabel>{t(group.labelKey)}</DropdownMenuLabel>
                {group.tools.map(item)}
              </React.Fragment>
            ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
