import React from "react";
import { ChevronDown, GripHorizontal, Stamp } from "lucide-react";
import { ANNOTATION_STYLES } from "@/constants";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useLanguage } from "../language-provider";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Slider } from "../ui/slider";
import { ColorPickerPopover } from "./ColorPickerPopover";
import {
  ShapeBorderStyleDropdown,
  ShapeDashDensityControl,
} from "./ShapeBorderStyleSection";
import { StrokePreview } from "./StrokePreview";
import { StrokeWidthControl } from "./StrokeWidthControl";
import { StampStylePopover } from "./StampStylePopover";
import { TOOL_DEFINITIONS } from "./toolDefinitions";

import type {
  ToolOptionsState,
  ToolStyleCommands,
  StrokePreviewProps,
  ResponsiveToolbarItem,
} from "./types";

export function ToolOptionPopover({
  label,
  trigger,
  children,
}: {
  label: string;
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  useAppEvent("workspace:pointerDown", () => setOpen(false));
  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="h-8 gap-1.5 px-2"
          title={label}
          aria-label={label}
        >
          {trigger}
          <ChevronDown size={12} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        sideOffset={12}
        className="w-64 max-w-[calc(100vw-2rem)] p-4"
        data-app-block-modifier-wheel-zoom="1"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

function NumericToolOption({
  label,
  value,
  min,
  max,
  unit,
  onChange,
  preview,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
  preview?: React.ReactNode;
}) {
  return (
    <ToolOptionPopover
      label={label}
      trigger={
        <span className="tabular-nums">
          {value}
          {unit}
        </span>
      }
    >
      {preview}
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {value}
          {unit}
        </span>
      </div>
      <Slider
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={1}
        onValueChange={([next]) => onChange(next)}
      />
    </ToolOptionPopover>
  );
}

export function useToolOptions({
  state,
  commands,
}: {
  state: ToolOptionsState;
  commands: ToolStyleCommands;
}): ResponsiveToolbarItem[] {
  const { t } = useLanguage();
  const kind = TOOL_DEFINITIONS[state.tool].style;
  if (kind === "none") return [];
  if (kind === "stamp") {
    return [
      {
        id: "stamp",
        label: t("toolbar.stamp_properties"),
        content: (
          <StampStylePopover
            value={state.stampStyle}
            onChange={commands.changeStampStyle}
            title={t("toolbar.stamp_properties")}
            side="top"
          >
            <Button
              variant="ghost"
              className="h-8 gap-1.5 px-2"
              title={t("toolbar.stamp_properties")}
              aria-label={t("toolbar.stamp_properties")}
            >
              <Stamp size={16} />
              <span>{t("toolbar.stamp_properties")}</span>
              <ChevronDown size={12} />
            </Button>
          </StampStylePopover>
        ),
      },
    ];
  }
  const style =
    kind === "pen"
      ? state.penStyle
      : kind === "highlight"
        ? (state.highlightStyle ?? ANNOTATION_STYLES.highlight)
        : kind === "shape"
          ? (state.shapeStyle ?? ANNOTATION_STYLES.shape)
          : kind === "comment"
            ? (state.commentStyle ?? ANNOTATION_STYLES.comment)
            : (state.freetextStyle ?? ANNOTATION_STYLES.freetext);
  const change =
    kind === "pen"
      ? commands.changePenStyle
      : kind === "highlight"
        ? commands.changeHighlightStyle
        : kind === "shape"
          ? commands.changeShapeStyle
          : kind === "comment"
            ? commands.changeCommentStyle
            : commands.changeFreetextStyle;
  const stroke =
    kind === "pen"
      ? state.penStyle
      : kind === "highlight"
        ? (state.highlightStyle ?? ANNOTATION_STYLES.highlight)
        : kind === "shape"
          ? (state.shapeStyle ?? ANNOTATION_STYLES.shape)
          : null;
  const changeStroke =
    kind === "pen"
      ? commands.changePenStyle
      : kind === "highlight"
        ? commands.changeHighlightStyle
        : commands.changeShapeStyle;
  const preview: StrokePreviewProps | null = stroke
    ? {
        variant: kind === "highlight" ? "highlight" : "stroke",
        color: stroke.color,
        thickness: stroke.thickness,
        opacity: stroke.opacity,
        linecap: kind === "highlight" || kind === "shape" ? "butt" : "round",
        borderStyle:
          kind === "shape"
            ? (state.shapeStyle?.borderStyle ??
              ANNOTATION_STYLES.shape.borderStyle)
            : undefined,
        dashDensity:
          kind === "shape" ? state.shapeStyle?.dashDensity : undefined,
      }
    : null;
  const options: ResponsiveToolbarItem[] = [
    {
      id: "color",
      label: t("properties.color"),
      content: (
        <ColorPickerPopover
          color={style.color}
          onColorChange={(color) => change({ color })}
          paletteType={kind === "highlight" ? "background" : "foreground"}
          showThickness={false}
          showOpacity={false}
          side="top"
          title={t("properties.color")}
          thickness={stroke?.thickness}
          opacity={stroke?.opacity}
          previewVariant={preview?.variant}
          previewStrokeLinecap={preview?.linecap}
          previewBorderStyle={preview?.borderStyle}
          previewDashDensity={preview?.dashDensity}
        >
          <Button
            variant="ghost"
            className="h-8 gap-1.5 px-2"
            title={t("properties.color")}
            aria-label={t("properties.color")}
          >
            <span
              className="size-4 rounded-full border border-black/10 dark:border-white/20"
              style={{ backgroundColor: style.color }}
            />
            <ChevronDown size={12} />
          </Button>
        </ColorPickerPopover>
      ),
    },
  ];
  if (stroke && preview) {
    options.push(
      {
        id: "thickness",
        label: t("properties.thickness"),
        content: (
          <ToolOptionPopover
            label={t("properties.thickness")}
            trigger={
              <>
                <StrokePreview {...preview} compact />
                <span className="tabular-nums">{stroke.thickness} px</span>
              </>
            }
          >
            <StrokePreview {...preview} />
            <StrokeWidthControl
              {...preview}
              min={kind === "shape" ? 0 : 1}
              onChange={(thickness) => changeStroke({ thickness })}
            />
          </ToolOptionPopover>
        ),
      },
      {
        id: "opacity",
        label: t("properties.opacity"),
        content: (
          <NumericToolOption
            label={t("properties.opacity")}
            value={Math.round((stroke.opacity ?? 1) * 100)}
            min={0}
            max={100}
            unit="%"
            onChange={(opacity) => changeStroke({ opacity: opacity / 100 })}
            preview={<StrokePreview {...preview} />}
          />
        ),
      },
    );
  }
  if (kind === "shape") {
    options.push({
      id: "border",
      label: t("properties.border_style"),
      content: (
        <ShapeBorderStyleDropdown
          compact
          value={
            state.shapeStyle?.borderStyle ?? ANNOTATION_STYLES.shape.borderStyle
          }
          onChange={(borderStyle) => commands.changeShapeStyle({ borderStyle })}
        />
      ),
    });
    if (state.shapeStyle?.borderStyle === "dashed") {
      options.push({
        id: "density",
        label: t("properties.dash_density"),
        content: (
          <ToolOptionPopover
            label={t("properties.dash_density")}
            trigger={<GripHorizontal size={16} />}
          >
            {preview && <StrokePreview {...preview} />}
            <ShapeDashDensityControl
              value={state.shapeStyle.dashDensity}
              onChange={(dashDensity) =>
                commands.changeShapeStyle({ dashDensity })
              }
            />
          </ToolOptionPopover>
        ),
      });
    }
  }
  return options;
}
