import React from "react";
import { cn } from "../../utils/cn";
import { Slider } from "../ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { ChevronDown } from "lucide-react";
import { useLanguage } from "../language-provider";
import { ColorPaletteControl } from "../ui/color-palette";
import type { ColorPaletteType } from "@/lib/colorPalette";
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
  previewStrokeLinecap?: "round" | "butt" | "square";
  side?: React.ComponentProps<typeof PopoverContent>["side"];
  align?: React.ComponentProps<typeof PopoverContent>["align"];
  title?: string;
  children?: React.ReactNode;
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
  previewStrokeLinecap = "round",
  side = "bottom",
  align = "center",
  title = "Properties",
  children,
  onInteractionStart,
  closeOnWorkspacePointerDown,
}) => {
  const { t } = useLanguage();
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
        className="w-72 p-4"
        side={side}
        align={align}
        data-app-block-modifier-wheel-zoom="1"
      >
        <div className="space-y-4">
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
            <>
              <div className="bg-muted/30 border-border flex h-16 items-center justify-center overflow-hidden rounded-md border">
                <svg
                  width="100%"
                  height="100%"
                  viewBox="0 0 200 60"
                  className="pointer-events-none"
                >
                  <path
                    d="M 20 30 Q 60 10, 100 30 T 180 30"
                    fill="none"
                    stroke={color}
                    strokeWidth={thickness}
                    opacity={opacity}
                    strokeLinecap={previewStrokeLinecap}
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium">
                    {t("properties.thickness")}
                  </label>
                  <span className="text-muted-foreground text-xs">
                    {thickness}px
                  </span>
                </div>
                <Slider
                  defaultValue={[thickness]}
                  value={[thickness]}
                  max={20}
                  min={minThickness}
                  step={1}
                  onValueChange={(val) => {
                    ensureInteractionStarted();
                    onThicknessChange(val[0]);
                  }}
                />
                <div className="text-muted-foreground mt-1 flex justify-between text-xs">
                  <span>Thin</span>
                  <span>Thick</span>
                </div>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
