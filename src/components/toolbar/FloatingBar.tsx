import React from "react";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  MoveHorizontal,
  MoveVertical,
  Columns2,
  Square,
  FileCog2,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import { useLanguage } from "../language-provider";
import type { PageFlowDirection, PageLayoutMode } from "../../types";

interface FloatingBarProps {
  scale: number;
  pageLayout: PageLayoutMode;
  pageFlow: PageFlowDirection;
  isFullscreen: boolean;
  onPageLayoutChange: (layout: PageLayoutMode) => void;
  onPageFlowChange: (flow: PageFlowDirection) => void;
  onToggleFullscreen: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitScreen: () => void;
}

const FloatingBar: React.FC<FloatingBarProps> = ({
  scale,
  pageLayout,
  pageFlow,
  isFullscreen,
  onPageLayoutChange,
  onPageFlowChange,
  onToggleFullscreen,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onFitScreen,
}) => {
  const percentage = Math.round(scale * 100);
  const { t } = useLanguage();

  return (
    <div className="bg-background border-border absolute bottom-6 left-1/2 z-40 flex -translate-x-1/2 transform items-center gap-1 rounded-lg border p-1 shadow-lg transition-colors duration-200">
      <Button
        variant="ghost"
        size="icon"
        onClick={onZoomOut}
        title={t("toolbar.zoom_out")}
        className="h-8 w-8"
      >
        <ZoomOut size={16} />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div
            className="text-foreground hover:text-primary min-w-12 cursor-pointer px-2 text-center text-sm font-medium"
            onClick={onFitWidth}
            title={t("toolbar.zoom")}
          >
            {percentage}%
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent sideOffset={12}>
          <DropdownMenuItem onClick={onFitWidth}>
            <MoveHorizontal size={14} />
            {t("toolbar.fit_width")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onFitScreen}>
            <Maximize2 size={14} />
            {t("toolbar.fit_screen")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="icon"
        onClick={onZoomIn}
        title={t("toolbar.zoom_in")}
        className="h-8 w-8"
      >
        <ZoomIn size={16} />
      </Button>

      <DropdownMenuSeparator />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            title={t("toolbar.page_layout")}
            className={"h-8 w-8"}
          >
            <FileCog2 size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent sideOffset={12} align="end" className="min-w-48">
          <DropdownMenuLabel>{t("toolbar.page_settings")}</DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-xs font-medium data-inset:pl-8">
            {t("toolbar.page_mode")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={pageLayout}
            onValueChange={(value) => {
              onPageLayoutChange(value as PageLayoutMode);
            }}
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
            onValueChange={(value) => {
              onPageFlowChange(value as PageFlowDirection);
            }}
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
            onCheckedChange={() => {
              onToggleFullscreen();
            }}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {isFullscreen
              ? t("toolbar.fullscreen_exit")
              : t("toolbar.fullscreen_enter")}
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default FloatingBar;
