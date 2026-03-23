import React from "react";
import { FormControlProps } from "../types";
import { ControlWrapper } from "../ControlWrapper";
import { cn } from "@/utils/cn";
import { getInnerSizeFromOuterAabb } from "@/lib/controlRotation";

export const RadioControl: React.FC<FormControlProps> = (props) => {
  const { data, isFormMode, isAnnotationMode, isSelectable, onUpdate } = props;
  const style = data.style || {};
  const rotationDeg =
    typeof data.rotationDeg === "number" && Number.isFinite(data.rotationDeg)
      ? data.rotationDeg
      : 0;
  const visualRect =
    rotationDeg === 0
      ? data.rect
      : getInnerSizeFromOuterAabb(data.rect, rotationDeg);
  const circleSizePercent =
    (Math.min(visualRect.width, visualRect.height) / visualRect.width) * 100;
  const circleHeightPercent =
    (Math.min(visualRect.width, visualRect.height) / visualRect.height) * 100;

  // Radio doesn't use the common container style for background/border on the wrapper
  // It renders a circle inside.

  const handleInteraction = () => {
    if (isAnnotationMode) {
      onUpdate(data.id, { isChecked: true });
    }
  };

  return (
    <ControlWrapper
      {...props}
      showBorder={props.isSelected && isFormMode}
      resizable={true}
    >
      <div
        className={cn(
          "relative flex h-full w-full items-center justify-center transition-colors",
          isAnnotationMode && isSelectable && "cursor-pointer hover:bg-black/5",
          isAnnotationMode && !isSelectable && "pointer-events-none",
          isFormMode && isSelectable && "pointer-events-none",
        )}
        onClick={handleInteraction}
      >
        <div
          className="relative box-border flex items-center justify-center rounded-full border border-black"
          style={{
            width: `${circleSizePercent}%`,
            height: `${circleHeightPercent}%`,
            backgroundColor: !style.isTransparent
              ? style.backgroundColor
              : "white",
          }}
        >
          {data.isChecked && (
            <div className="h-1/2 w-1/2 rounded-full bg-black"></div>
          )}
        </div>
      </div>
    </ControlWrapper>
  );
};
