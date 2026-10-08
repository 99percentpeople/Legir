import React from "react";
import { cn } from "../../utils/cn";
import { StrokeWidthControl } from "./StrokeWidthControl";
import { StrokePreview } from "./StrokePreview";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { ChevronDown } from "lucide-react";
import { ColorPaletteControl } from "../ui/color-palette";
import type { ColorPaletteType } from "@/lib/colorPalette";
import type { ShapeBorderStyle } from "@/lib/shapeGeometry";
import type { StrokePreviewProps } from "./types";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useWorkspacePointerDownDismiss } from "@/lib/workspacePointerDownDismissContext";

interface ColorPickerPopoverProps {
  color: string;
  thickness?: number;
  opacity?: number;
  onColorChange: (color: string) => void;
  onThicknessChange?: (thickness: number) => void;
  onOpacityChange?: (opacity: number) => void;
  isActive?: boolean;
  showThickness?: boolean;
  minThickness?: number;
  showOpacity?: boolean;
  paletteType?: ColorPaletteType;
  previewVariant?: StrokePreviewProps["variant"];
  previewStrokeLinecap?: "round" | "butt" | "square";
  previewBorderStyle?: ShapeBorderStyle;
  previewDashDensity?: number;
  side?: React.ComponentProps<typeof PopoverContent>["side"];
  align?: React.ComponentProps<typeof PopoverContent>["align"];
  title?: string;
  children?: React.ReactNode;
  extraContent?: React.ReactNode;
  onInteractionStart?: () => void;
  closeOnWorkspacePointerDown?: boolean;
}

export const ColorPickerPopover: React.FC<ColorPickerPopoverProps> = ({
  color,
  thickness,
  opacity,
  onColorChange,
  onThicknessChange,
  onOpacityChange,
  isActive = false,
  showThickness = true,
  minThickness = 1,
  showOpacity = true,
  paletteType = "foreground",
  previewVariant,
  previewStrokeLinecap = "round",
  previewBorderStyle,
  previewDashDensity,
  side = "bottom",
  align = "center",
  title = "Properties",
  children,
  extraContent,
  onInteractionStart,
  closeOnWorkspacePointerDown,
}) => {
  // Most toolbar popovers should close when the user clicks back into the
  // workspace; floating control toolbars override this via context.
  const inheritedCloseOnWorkspacePointerDown = useWorkspacePointerDownDismiss();
  const shouldCloseOnWorkspacePointerDown =
    closeOnWorkspacePointerDown ?? inheritedCloseOnWorkspacePointerDown;

  const [open, setOpen] = React.useState(false);
  const hasStartedInteractionRef = React.useRef(false);

  useAppEvent("workspace:pointerDown", () => {
    if (!shouldCloseOnWorkspacePointerDown) return;
    setOpen(false);
  });

  const ensureInteractionStarted = React.useCallback(() => {
    if (hasStartedInteractionRef.current) return;
    hasStartedInteractionRef.current = true;
    onInteractionStart?.();
  }, [onInteractionStart]);

  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          hasStartedInteractionRef.current = false;
        }
      }}
    >
      <PopoverTrigger asChild>
        {children ? (
          children
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "hover:bg-muted h-8 w-8 rounded-l-none p-0 sm:h-9 sm:w-5",
              isActive &&
                "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground",
            )}
            title={title}
          >
            <ChevronDown size={12} />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        className="w-72 max-w-[calc(100vw-2rem)] p-4"
        side={side}
        align={align}
        data-app-block-modifier-wheel-zoom="1"
      >
        <div className="space-y-4">
          {thickness !== undefined && (
            <StrokePreview
              variant={previewVariant}
              color={color}
              thickness={thickness}
              opacity={opacity}
              linecap={previewStrokeLinecap}
              borderStyle={previewBorderStyle}
              dashDensity={previewDashDensity}
            />
          )}
          <ColorPaletteControl
            color={color}
            opacity={opacity}
            paletteType={paletteType}
            onColorChange={(nextColor) => {
              ensureInteractionStarted();
              onColorChange(nextColor);
            }}
            onOpacityChange={
              onOpacityChange
                ? (nextOpacity) => {
                    ensureInteractionStarted();
                    onOpacityChange(nextOpacity);
                  }
                : undefined
            }
            onInteractionStart={ensureInteractionStarted}
            showOpacity={showOpacity}
          />

          {showThickness && thickness !== undefined && onThicknessChange && (
            <StrokeWidthControl
              variant={previewVariant}
              color={color}
              thickness={thickness}
              opacity={opacity}
              linecap={previewStrokeLinecap}
              min={minThickness}
              borderStyle={previewBorderStyle}
              dashDensity={previewDashDensity}
              onChange={(nextThickness) => {
                ensureInteractionStarted();
                onThicknessChange(nextThickness);
              }}
            />
          )}

          {extraContent}
        </div>
      </PopoverContent>
    </Popover>
  );
};
