import React, { useMemo } from "react";
import { AnnotationControlProps } from "../types";
import { cn } from "@/lib/utils";

export const InkControl: React.FC<AnnotationControlProps> = ({
  data,
  scale,
  onSelect,
  isSelected,
  isSelectable,
}) => {
  // Calculate bounding box
  const bounds = useMemo(() => {
    if (!data.points || data.points.length === 0) return null;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    data.points.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });

    // Add some padding
    const padding = (data.thickness || 1) / 2 + 2;
    return {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
      originX: minX - padding,
      originY: minY - padding,
    };
  }, [data.points, data.thickness]);

  // Construct path data relative to bounding box
  const pathData = useMemo(() => {
    if (!data.points || data.points.length < 2 || !bounds) return "";
    return (
      `M ${(data.points[0].x - bounds.originX) * scale} ${(data.points[0].y - bounds.originY) * scale} ` +
      data.points
        .slice(1)
        .map(
          (p) =>
            `L ${(p.x - bounds.originX) * scale} ${(p.y - bounds.originY) * scale}`,
        )
        .join(" ")
    );
  }, [data.points, bounds, scale]);

  if (!bounds || !data.points) return null;

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: bounds.x * scale,
        top: bounds.y * scale,
        width: bounds.width * scale,
        height: bounds.height * scale,
      }}
    >
      <svg width="100%" height="100%" className="overflow-visible">
        <path
          d={pathData}
          fill="none"
          stroke={data.color || "#000000"}
          strokeWidth={(data.thickness || 1) * scale}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(
            "pointer-events-auto cursor-pointer transition-opacity",
            isSelected
              ? "opacity-100"
              : cn("opacity-90", !isSelectable && "hover:opacity-100"),
          )}
          style={{ cursor: isSelectable ? "grab" : "pointer" }}
          onPointerDown={(e) => {
            if (isSelectable) return;
            e.stopPropagation();
            onSelect(data.id);
          }}
        />
      </svg>
      {isSelected && (
        <div className="pointer-events-none absolute inset-0 border border-dashed border-blue-500" />
      )}
    </div>
  );
};
