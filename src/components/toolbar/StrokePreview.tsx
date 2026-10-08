import { getShapeStrokeDashArray } from "@/lib/shapeGeometry";
import { useLanguage } from "../language-provider";
import type { StrokePreviewProps } from "./types";

export function StrokePreview({
  variant = "stroke",
  color,
  thickness,
  opacity = 1,
  linecap = "round",
  borderStyle,
  dashDensity,
  compact = false,
}: StrokePreviewProps) {
  const { t } = useLanguage();
  // The compact marker curve stays wider and gentler than the ink curve:
  // its minimum radius (18px) exceeds even the thickest preset's half-width.
  return (
    <svg
      data-stroke-preview
      role={compact ? undefined : "img"}
      aria-label={compact ? undefined : t("properties.stroke_preview")}
      aria-hidden={compact || undefined}
      viewBox={compact ? "0 0 48 28" : "0 0 220 64"}
      className={
        compact
          ? "pointer-events-none size-auto shrink-0"
          : "bg-muted/30 border-border pointer-events-none h-16 w-full rounded-md border"
      }
      style={compact ? { width: 48, height: 28 } : undefined}
    >
      <path
        d={
          compact
            ? variant === "highlight"
              ? "M 6 14 Q 15 9.5, 24 14 T 42 14"
              : borderStyle
                ? "M 12 14 H 36"
                : "M 12 14 Q 18 8, 24 14 T 36 14"
            : borderStyle
              ? "M 16 32 H 204"
              : "M 16 32 Q 63 10, 110 32 T 204 32"
        }
        fill="none"
        stroke={color}
        strokeWidth={thickness}
        opacity={opacity}
        strokeLinecap={variant === "highlight" ? "butt" : linecap}
        strokeLinejoin="round"
        strokeDasharray={
          borderStyle
            ? getShapeStrokeDashArray(borderStyle, thickness, dashDensity)
            : undefined
        }
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
