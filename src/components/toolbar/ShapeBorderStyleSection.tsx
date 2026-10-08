import React from "react";
import { ChevronDown } from "lucide-react";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useWorkspacePointerDownDismiss } from "@/lib/workspacePointerDownDismissContext";
import { useLanguage } from "../language-provider";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  DEFAULT_SHAPE_DASH_DENSITY,
  MAX_SHAPE_DASH_DENSITY,
  MIN_SHAPE_DASH_DENSITY,
  normalizeShapeDashDensity,
  getShapeStrokeDashArray,
  type ShapeBorderStyle,
} from "@/lib/shapeGeometry";
import { Slider } from "../ui/slider";

interface ShapeBorderStyleSectionProps {
  value: ShapeBorderStyle;
  dashDensity?: number;
  onChange: (value: ShapeBorderStyle) => void;
  onDashDensityChange?: (value: number) => void;
  onInteractionStart?: () => void;
}

function BorderStylePreview({ value }: { value: ShapeBorderStyle }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 12" className="size-auto h-3 w-8">
      <path
        d="M 2 6 H 30"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeDasharray={getShapeStrokeDashArray(value, 2)}
      />
    </svg>
  );
}

export function ShapeBorderStyleDropdown({
  value,
  onChange,
  onInteractionStart,
  compact = false,
}: Pick<
  ShapeBorderStyleSectionProps,
  "value" | "onChange" | "onInteractionStart"
> & { compact?: boolean }) {
  const { t } = useLanguage();
  const [open, setOpen] = React.useState(false);
  const closeOnWorkspacePointerDown = useWorkspacePointerDownDismiss();
  useAppEvent("workspace:pointerDown", () => {
    if (closeOnWorkspacePointerDown) setOpen(false);
  });
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={compact ? "ghost" : "outline"}
          aria-label={t("properties.border_style")}
          title={t("properties.border_style")}
          className={
            compact
              ? "h-8 gap-1.5 px-2"
              : "h-9 w-full justify-between gap-2 px-3"
          }
        >
          <BorderStylePreview value={value} />
          {!compact && (
            <span className="flex-1 text-left">{t("properties." + value)}</span>
          )}
          <ChevronDown size={12} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={compact ? "top" : "bottom"}
        sideOffset={compact ? 12 : 4}
        align="center"
        className="min-w-40"
        data-app-block-modifier-wheel-zoom="1"
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (next === value || (next !== "solid" && next !== "dashed"))
              return;
            onInteractionStart?.();
            onChange(next);
          }}
        >
          {(["solid", "dashed"] as const).map((style) => (
            <DropdownMenuRadioItem
              key={style}
              value={style}
              className="min-h-9 gap-3 px-3 pr-8"
            >
              <BorderStylePreview value={style} />
              {t("properties." + style)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ShapeDashDensityControl({
  value = DEFAULT_SHAPE_DASH_DENSITY,
  onChange,
  onInteractionStart,
}: {
  value?: number;
  onChange: (value: number) => void;
  onInteractionStart?: () => void;
}) {
  const { t } = useLanguage();
  const density = normalizeShapeDashDensity(value);
  const interactionStarted = React.useRef(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {t("properties.dash_density")}
        </span>
        <span className="text-muted-foreground text-xs">
          {Math.round(density * 100)}%
        </span>
      </div>
      <Slider
        aria-label={t("properties.dash_density")}
        value={[density]}
        min={MIN_SHAPE_DASH_DENSITY}
        max={MAX_SHAPE_DASH_DENSITY}
        step={0.1}
        onPointerDownCapture={() => {
          interactionStarted.current = false;
        }}
        onKeyDownCapture={() => {
          interactionStarted.current = false;
        }}
        onValueChange={([next]) => {
          if (!interactionStarted.current) {
            interactionStarted.current = true;
            onInteractionStart?.();
          }
          onChange(normalizeShapeDashDensity(next));
        }}
      />
    </div>
  );
}

export const ShapeBorderStyleSection: React.FC<
  ShapeBorderStyleSectionProps
> = ({
  value,
  dashDensity = DEFAULT_SHAPE_DASH_DENSITY,
  onChange,
  onDashDensityChange,
  onInteractionStart,
}) => {
  const { t } = useLanguage();
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{t("properties.border_style")}</div>
      <ShapeBorderStyleDropdown
        value={value}
        onChange={onChange}
        onInteractionStart={onInteractionStart}
      />
      {value === "dashed" && onDashDensityChange && (
        <div className="pt-1">
          <ShapeDashDensityControl
            value={dashDensity}
            onChange={onDashDensityChange}
            onInteractionStart={onInteractionStart}
          />
        </div>
      )}
    </div>
  );
};
