import React from "react";
import { AnnotationControlProps } from "../types";
import { cn } from "@/lib/utils";

export const HighlightControl: React.FC<AnnotationControlProps> = ({
  data,
  scale,
  onSelect,
  isSelectable,
}) => {
  const renderBox = (
    r: { x: number; y: number; width: number; height: number },
    keySuffix: string = "",
  ) => (
    <div
      key={data.id + keySuffix}
      className={cn("pointer-events-auto absolute transition-colors")}
      style={{
        left: r.x * scale,
        top: r.y * scale,
        width: r.width * scale,
        height: r.height * scale,
        backgroundColor: data.color,
        opacity: data.opacity !== undefined ? data.opacity : 0.4,
        cursor: isSelectable ? "grab" : "inherit",
        mixBlendMode: "multiply",
      }}
      onPointerDown={(e) => {
        if (isSelectable) return;
        e.stopPropagation();
        e.preventDefault();
        onSelect(data.id);
      }}
    />
  );

  if (data.rects && data.rects.length > 0) {
    return (
      <React.Fragment>
        {data.rects.map((r, idx) => renderBox(r, `_part_${idx}`))}
      </React.Fragment>
    );
  } else if (data.rect) {
    return renderBox(data.rect);
  }
  return null;
};
