import React from "react";
import { ArrowLeftRight, Palette } from "lucide-react";

import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  getDefaultArrowSize,
  getShapeArrowStyles,
  getShapeArrowStyleUpdates,
  getShapeTypeWithoutArrow,
  isOpenLineShapeType,
  reverseShapePoints,
  SHAPE_ARROW_STYLE_OPTIONS,
  type ShapeArrowStyle,
  shapeSupportsFill,
} from "@/lib/shapeGeometry";
import type { Annotation } from "@/types";

import type { PropertyPanelProps } from "./types";

export const ShapeProperties: React.FC<PropertyPanelProps<Annotation>> = ({
  data,
  onChange,
  onTriggerHistorySave,
}) => {
  const { t } = useLanguage();

  const strokeColor = data.color || "#000000";
  const thickness =
    typeof data.thickness === "number" && Number.isFinite(data.thickness)
      ? Math.max(1, data.thickness)
      : 2;
  const opacity =
    typeof data.opacity === "number" && Number.isFinite(data.opacity)
      ? Math.max(0.05, Math.min(1, data.opacity))
      : 1;
  const canFill = shapeSupportsFill(data.shapeType);
  const supportsArrowSize = isOpenLineShapeType(data.shapeType);
  const arrowStyles = getShapeArrowStyles(data);
  const isTransparent = !data.backgroundColor;
  const arrowSize =
    typeof data.arrowSize === "number" && Number.isFinite(data.arrowSize)
      ? Math.max(6, Math.min(64, data.arrowSize))
      : getDefaultArrowSize(thickness);
  const cloudIntensity =
    typeof data.cloudIntensity === "number" &&
    Number.isFinite(data.cloudIntensity)
      ? Math.max(0.5, Math.min(4, data.cloudIntensity))
      : 2;
  const cloudSpacing =
    typeof data.cloudSpacing === "number" && Number.isFinite(data.cloudSpacing)
      ? Math.max(12, Math.min(96, data.cloudSpacing))
      : 28;
  const pointCount = data.shapePoints?.length ?? 2;
  const canSwitchBoxShapeType =
    data.shapeType === "square" ||
    data.shapeType === "circle" ||
    data.shapeType === "cloud";

  const arrowStyleLabel = (style: ShapeArrowStyle) =>
    t(`properties.arrow_style_${style}`) ||
    {
      closed_arrow: "Closed Arrow",
      line_arrow: "Line Arrow",
      hollow_arrow: "Hollow Arrow",
      circle: "Circle",
      square: "Square",
      diamond: "Diamond",
      slash: "Slash",
    }[style];

  const updateEndpointArrowStyle = (
    endpoint: "start" | "end",
    value: string,
  ) => {
    onTriggerHistorySave();
    const nextStyles = {
      ...arrowStyles,
      [endpoint]: value === "none" ? null : (value as ShapeArrowStyle),
    };

    onChange({
      shapeType:
        nextStyles.start || nextStyles.end
          ? "arrow"
          : getShapeTypeWithoutArrow(pointCount),
      arrowSize,
      appearanceStreamContent: undefined,
      ...getShapeArrowStyleUpdates(nextStyles),
    });
  };

  return (
    <div>
      <h4 className="text-muted-foreground mb-3 flex items-center text-xs font-semibold tracking-wider uppercase">
        <Palette size={12} className="mr-1.5" />
        {t("properties.appearance")}
      </h4>
      <div className="space-y-4">
        {canSwitchBoxShapeType && (
          <div className="space-y-2">
            <Label>{t("properties.shape_type") || "Shape Type"}</Label>
            <Select
              value={data.shapeType}
              onValueChange={(value) => {
                onTriggerHistorySave();
                onChange({
                  shapeType: value as "square" | "circle" | "cloud",
                  appearanceStreamContent: undefined,
                });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="square">{t("toolbar.square")}</SelectItem>
                <SelectItem value="circle">{t("toolbar.circle")}</SelectItem>
                <SelectItem value="cloud">{t("toolbar.cloud")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2">
          <Label>{t("properties.color")}</Label>
          <input
            type="color"
            value={strokeColor}
            onMouseDown={onTriggerHistorySave}
            onChange={(e) =>
              onChange({
                color: e.target.value,
                appearanceStreamContent: undefined,
              })
            }
            className="border-input bg-background h-8 w-full cursor-pointer rounded border"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t("properties.thickness") || "Thickness"}</Label>
            <span className="text-muted-foreground text-xs">{thickness}px</span>
          </div>
          <Slider
            value={[thickness]}
            min={1}
            max={20}
            step={1}
            onValueCommit={onTriggerHistorySave}
            onValueChange={(values) =>
              onChange({
                thickness: values[0],
                appearanceStreamContent: undefined,
              })
            }
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t("properties.opacity")}</Label>
            <span className="text-muted-foreground text-xs">
              {Math.round(opacity * 100)}%
            </span>
          </div>
          <Slider
            value={[opacity]}
            min={0.05}
            max={1}
            step={0.05}
            onValueCommit={onTriggerHistorySave}
            onValueChange={(values) =>
              onChange({
                opacity: values[0],
                appearanceStreamContent: undefined,
              })
            }
          />
        </div>

        {supportsArrowSize && (
          <>
            <div className="space-y-2">
              <Label>{t("properties.start_arrow") || "Start Arrow"}</Label>
              <Select
                value={arrowStyles.start ?? "none"}
                onValueChange={(value) =>
                  updateEndpointArrowStyle("start", value)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {t("properties.none") || "None"}
                  </SelectItem>
                  {SHAPE_ARROW_STYLE_OPTIONS.map((style) => (
                    <SelectItem key={style} value={style}>
                      {arrowStyleLabel(style)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("properties.end_arrow") || "End Arrow"}</Label>
              <Select
                value={arrowStyles.end ?? "none"}
                onValueChange={(value) =>
                  updateEndpointArrowStyle("end", value)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {t("properties.none") || "None"}
                  </SelectItem>
                  {SHAPE_ARROW_STYLE_OPTIONS.map((style) => (
                    <SelectItem key={style} value={style}>
                      {arrowStyleLabel(style)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("properties.arrow_size") || "Arrow Size"}</Label>
                <span className="text-muted-foreground text-xs">
                  {arrowSize}px
                </span>
              </div>
              <Slider
                value={[arrowSize]}
                min={6}
                max={64}
                step={1}
                onValueCommit={onTriggerHistorySave}
                onValueChange={(values) =>
                  onChange({
                    arrowSize: values[0],
                    appearanceStreamContent: undefined,
                  })
                }
              />
            </div>
          </>
        )}

        {canFill && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>{t("properties.background")}</Label>
              <div className="flex items-center gap-2">
                <Switch
                  id="shapeTransparent"
                  checked={isTransparent}
                  onMouseDown={onTriggerHistorySave}
                  onCheckedChange={(checked) =>
                    onChange({
                      backgroundColor: checked ? undefined : "#ffffff",
                      appearanceStreamContent: undefined,
                    })
                  }
                />
                <Label
                  htmlFor="shapeTransparent"
                  className="text-xs font-normal"
                >
                  {t("properties.transparent")}
                </Label>
              </div>
            </div>
            <input
              type="color"
              disabled={isTransparent}
              value={data.backgroundColor || "#ffffff"}
              onMouseDown={onTriggerHistorySave}
              onChange={(e) =>
                onChange({
                  backgroundColor: e.target.value,
                  appearanceStreamContent: undefined,
                })
              }
              className="border-input bg-background h-8 w-full cursor-pointer rounded border disabled:opacity-50"
            />
          </div>
        )}

        {data.shapeType === "arrow" &&
          data.shapePoints &&
          data.shapePoints.length >= 2 && (
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={() => {
                onTriggerHistorySave();
                onChange({
                  shapePoints: reverseShapePoints(data.shapePoints),
                  appearanceStreamContent: undefined,
                });
              }}
            >
              <ArrowLeftRight size={14} />
              {t("properties.reverse_direction") || "Reverse Direction"}
            </Button>
          )}

        {data.shapeType === "cloud" && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>
                  {t("properties.cloud_intensity") || "Cloud Intensity"}
                </Label>
                <span className="text-muted-foreground text-xs">
                  {cloudIntensity.toFixed(1)}
                </span>
              </div>
              <Slider
                value={[cloudIntensity]}
                min={0.5}
                max={4}
                step={0.1}
                onValueCommit={onTriggerHistorySave}
                onValueChange={(values) =>
                  onChange({
                    cloudIntensity: values[0],
                    appearanceStreamContent: undefined,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>
                  {t("properties.cloud_spacing") || "Cloud Spacing"}
                </Label>
                <span className="text-muted-foreground text-xs">
                  {cloudSpacing.toFixed(0)}px
                </span>
              </div>
              <Slider
                value={[cloudSpacing]}
                min={12}
                max={96}
                step={2}
                onValueCommit={onTriggerHistorySave}
                onValueChange={(values) =>
                  onChange({
                    cloudSpacing: values[0],
                    appearanceStreamContent: undefined,
                  })
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
