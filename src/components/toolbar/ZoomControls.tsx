import React from "react";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  MoveHorizontal,
  Columns2,
  Square,
} from "lucide-react";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useLanguage } from "../language-provider";
import type { PageLayoutMode } from "../../types";

interface ZoomControlsProps {
  scale: number;
  pageLayout: PageLayoutMode;
  onPageLayoutChange: (layout: PageLayoutMode) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitScreen: () => void;
}

const ZoomControls: React.FC<ZoomControlsProps> = ({
  scale,
  pageLayout,
  onPageLayoutChange,
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
        title="Zoom Out (Ctrl + -)"
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
        title="Zoom In (Ctrl + +)"
        className="h-8 w-8"
      >
        <ZoomIn size={16} />
      </Button>

      <Separator orientation="vertical" className="mx-1 h-4" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            title={t("toolbar.page_layout")}
            className={"h-8 w-8"}
          >
            {pageLayout === "double" ? (
              <Columns2 size={16} />
            ) : (
              <Square size={16} />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent sideOffset={12} align="end">
          <DropdownMenuRadioGroup
            value={pageLayout}
            onValueChange={(value) => {
              onPageLayoutChange(value as PageLayoutMode);
            }}
          >
            <DropdownMenuRadioItem value="single">
              <Square size={14} />
              {t("toolbar.page_layout_single")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="double">
              <Columns2 size={14} />
              {t("toolbar.page_layout_double")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default ZoomControls;
