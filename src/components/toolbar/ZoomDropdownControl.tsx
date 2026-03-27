import React from "react";
import {
  ChevronDown,
  Maximize2,
  MoveHorizontal,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { cn } from "@/utils/cn";
import { useLanguage } from "../language-provider";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

type ZoomDropdownControlProps = {
  scale: number;
  disabled?: boolean;
  compact?: boolean;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitScreen: () => void;
};

const ZoomDropdownControl: React.FC<ZoomDropdownControlProps> = ({
  scale,
  disabled = false,
  compact = true,
  side = "bottom",
  align = "start",
  className,
  open,
  onOpenChange,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onFitScreen,
}) => {
  const { t } = useLanguage();
  const percentage = `${Math.round(scale * 100)}%`;

  if (!compact) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={onZoomOut}
          title={t("toolbar.zoom_out")}
          className="h-8 w-8 sm:h-9 sm:w-9"
        >
          <ZoomOut size={16} />
        </Button>
        <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              className="h-8 px-2 text-sm font-medium sm:h-9"
              title={t("toolbar.zoom")}
            >
              <span className="min-w-11 text-center">{percentage}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={side}
            align={align}
            className="min-w-44"
            data-ff-block-modifier-wheel-zoom="1"
          >
            <DropdownMenuLabel>{t("toolbar.zoom")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
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
          disabled={disabled}
          onClick={onZoomIn}
          title={t("toolbar.zoom_in")}
          className="h-8 w-8 sm:h-9 sm:w-9"
        >
          <ZoomIn size={16} />
        </Button>
      </div>
    );
  }

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn("h-8 gap-1 px-2 text-sm font-medium sm:h-9", className)}
          title={t("toolbar.zoom")}
        >
          <span className="min-w-11 text-center">{percentage}</span>
          <ChevronDown size={12} className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={side}
        align={align}
        className="min-w-44"
        data-ff-block-modifier-wheel-zoom="1"
      >
        <DropdownMenuLabel>{t("toolbar.zoom")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onZoomIn}>
          <ZoomIn size={14} />
          {t("toolbar.zoom_in")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onZoomOut}>
          <ZoomOut size={14} />
          {t("toolbar.zoom_out")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
  );
};

export default ZoomDropdownControl;
