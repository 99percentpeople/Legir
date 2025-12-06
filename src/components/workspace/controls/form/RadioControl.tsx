import React from "react";
import { FormControlProps } from "../types";
import { ControlWrapper } from "../ControlWrapper";
import { cn } from "@/lib/utils";

export const RadioControl: React.FC<FormControlProps> = (props) => {
  const { data, isFormMode, isAnnotationMode, isSelectable, onUpdate } = props;
  const style = data.style || {};

  // Radio doesn't use the common container style for background/border on the wrapper
  // It renders a circle inside.

  const handleInteraction = () => {
    if (isAnnotationMode) {
      onUpdate(data.id, { isChecked: true });
    }
  };

  return (
    <ControlWrapper {...props}>
      <div
        className={cn(
          "relative flex h-full w-full items-center justify-center transition-colors",
          isAnnotationMode &&
            !isSelectable &&
            "cursor-pointer hover:bg-black/5",
          isSelectable && "pointer-events-none",
        )}
        onClick={handleInteraction}
      >
        <div
          className="relative box-border flex items-center justify-center rounded-full border border-black"
          style={{
            width: `${(Math.min(data.rect.width, data.rect.height) / data.rect.width) * 100}%`,
            height: `${(Math.min(data.rect.width, data.rect.height) / data.rect.height) * 100}%`,
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
