import React from "react";
import {
  Columns2,
  FileCog2,
  Maximize2,
  Minimize2,
  MoveHorizontal,
  MoveVertical,
  Square,
} from "lucide-react";

import { cn } from "@/utils/cn";
import type { PageFlowDirection, PageLayoutMode } from "@/types";
import { useLanguage } from "../language-provider";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
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
  onPageLayoutChange: (layout: PageLayoutMode) => void;
  onPageFlowChange: (flow: PageFlowDirection) => void;
  onToggleFullscreen: () => void;
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
  onPageLayoutChange,
  onPageFlowChange,
  onToggleFullscreen,
}) => {
  const { t } = useLanguage();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={t("toolbar.page_layout")}
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
      >
        <DropdownMenuLabel>{t("toolbar.page_settings")}</DropdownMenuLabel>
        <DropdownMenuSeparator />

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
