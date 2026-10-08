import React from "react";
import {
  Columns2,
  FileCog2,
  Maximize2,
  Minimize2,
  MoveHorizontal,
  MoveVertical,
  RotateCcw,
  RotateCw,
  Square,
  Undo2,
} from "lucide-react";

import { cn } from "@/utils/cn";
import type { PageFlowDirection, PageLayoutMode } from "@/types";
import { useLanguage } from "../language-provider";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

type PageSettingsDropdownControlProps = {
  pageLayout: PageLayoutMode;
  pageFlow: PageFlowDirection;
  isFullscreen: boolean;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  triggerClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onPageLayoutChange: (layout: PageLayoutMode) => void;
  onPageFlowChange: (flow: PageFlowDirection) => void;
  onToggleFullscreen: () => void;
  onRotateView?: (direction: "clockwise" | "counterclockwise") => void;
  viewRotation?: number;
  onResetViewRotation?: () => void;
  rotationDisabled?: boolean;
};

const PageSettingsDropdownControl: React.FC<
  PageSettingsDropdownControlProps
> = ({
  pageLayout,
  pageFlow,
  isFullscreen,
  side = "bottom",
  align = "end",
  sideOffset = 4,
  triggerClassName,
  open,
  onOpenChange,
  onPageLayoutChange,
  onPageFlowChange,
  onToggleFullscreen,
  onRotateView,
  viewRotation = 0,
  onResetViewRotation,
  rotationDisabled = false,
}) => {
  const { t } = useLanguage();

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={t("toolbar.page_settings")}
          aria-label={t("toolbar.page_settings")}
          className={cn("h-8 w-8 sm:h-9 sm:w-9", triggerClassName)}
        >
          <FileCog2 size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="min-w-48"
        data-app-block-modifier-wheel-zoom="1"
      >
        <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-xs font-medium data-inset:pl-8">
          {t("toolbar.page_mode")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={pageLayout}
          onValueChange={(value) => onPageLayoutChange(value as PageLayoutMode)}
        >
          <DropdownMenuRadioItem value="single">
            <Square size={14} />
            {t("toolbar.page_mode_single")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="double_odd">
            <Columns2 size={14} />
            {t("toolbar.page_mode_double_odd")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="double_even">
            <Columns2 size={14} />
            {t("toolbar.page_mode_double_even")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-xs font-medium data-inset:pl-8">
          {t("toolbar.page_flow")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={pageFlow}
          onValueChange={(value) =>
            onPageFlowChange(value as PageFlowDirection)
          }
        >
          <DropdownMenuRadioItem value="vertical">
            <MoveVertical size={14} />
            {t("toolbar.page_flow_vertical")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="horizontal">
            <MoveHorizontal size={14} />
            {t("toolbar.page_flow_horizontal")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        {onRotateView && (
          <>
            <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-xs font-medium data-inset:pl-8">
              {t("toolbar.rotate_view")}
            </DropdownMenuLabel>
            <DropdownMenuItem
              disabled={rotationDisabled}
              onSelect={() => onRotateView("counterclockwise")}
            >
              <RotateCcw size={14} />
              {t("toolbar.rotate_counterclockwise")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={rotationDisabled}
              onSelect={() => onRotateView("clockwise")}
            >
              <RotateCw size={14} />
              {t("toolbar.rotate_clockwise")}
            </DropdownMenuItem>
            {viewRotation !== 0 && onResetViewRotation && (
              <DropdownMenuItem onSelect={onResetViewRotation}>
                <Undo2 size={14} />
                {t("toolbar.reset_rotation")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-xs font-medium data-inset:pl-8">
          {t("toolbar.view")}
        </DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={isFullscreen}
          onCheckedChange={onToggleFullscreen}
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          {isFullscreen
            ? t("toolbar.fullscreen_exit")
            : t("toolbar.fullscreen_enter")}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default PageSettingsDropdownControl;
