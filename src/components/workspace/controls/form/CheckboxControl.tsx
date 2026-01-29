import React from "react";
import { Check } from "lucide-react";
import { FormControlProps } from "../types";
import { ControlWrapper } from "../ControlWrapper";
import { cn } from "@/lib/cn";
import { resolveFontStackWithCjkFallback } from "@/lib/fonts";

export const CheckboxControl: React.FC<FormControlProps> = (props) => {
  const { data, isFormMode, isAnnotationMode, isSelectable, onUpdate } = props;
  const style = data.style || {};

  const effectiveBorderStyle =
    style.borderStyle === "dashed"
      ? "dashed"
      : style.borderStyle === "underline"
        ? "solid"
        : "solid";

  const containerStyle: React.CSSProperties = {
    backgroundColor: !style.isTransparent ? style.backgroundColor : undefined,
    borderWidth: `calc(${style.borderWidth}px * var(--scale, 1))`,
    borderColor: style.borderColor,
    borderStyle: effectiveBorderStyle,
    fontSize: `calc(${style.fontSize || 12}px * var(--scale, 1))`,
    fontFamily: resolveFontStackWithCjkFallback(style.fontFamily),
    boxSizing: "border-box",
  };

  const showHelperBorder = (style.borderWidth ?? 1) === 0 && !props.isSelected;
  const showHelperBg = style.isTransparent && !props.isSelected;

  const handleInteraction = () => {
    if (isAnnotationMode) {
      onUpdate(data.id, { isChecked: !data.isChecked });
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
          "overflow-hidden",
          showHelperBg &&
            isFormMode &&
            cn(
              "bg-blue-500/10 dark:bg-blue-400/10",
              !isSelectable && "hover:bg-blue-500/20",
            ),
          isAnnotationMode && isSelectable && "cursor-pointer hover:bg-black/5",
          isAnnotationMode && !isSelectable && "pointer-events-none",
          isFormMode && isSelectable && "pointer-events-none",
        )}
        style={containerStyle}
        onClick={handleInteraction}
      >
        {/* Helper Border Overlay */}
        {showHelperBorder && isFormMode && (
          <div
            className="pointer-events-none absolute inset-0 border border-dashed border-blue-400/50"
            style={{ zIndex: 1 }}
          />
        )}

        {data.isChecked && <Check size="80%" className="text-blue-800" />}
      </div>
    </ControlWrapper>
  );
};
