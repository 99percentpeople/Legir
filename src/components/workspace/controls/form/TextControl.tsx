import React from "react";
import { FormControlProps } from "../types";
import { ControlWrapper } from "../ControlWrapper";
import { cn } from "@/lib/cn";
import { resolveFormControlFontFamilyCss } from "@/lib/fonts";

export const TextControl: React.FC<FormControlProps> = (props) => {
  const {
    data,
    isFormMode,
    isAnnotationMode,
    isSelectable,
    onUpdate,
    onSelect,
  } = props;
  const style = data.style || {};

  const displayedValue = isFormMode
    ? data.value || data.defaultValue || data.name
    : data.value || "";

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
    color: style.textColor,
    fontSize: `calc(${style.fontSize || 12}px * var(--scale, 1))`,
    fontFamily: resolveFormControlFontFamilyCss(
      style.fontFamily,
      displayedValue,
    ),
    boxSizing: "border-box",
  };

  const showHelperBorder = (style.borderWidth ?? 1) === 0 && !props.isSelected;
  const showHelperBg = style.isTransparent && !props.isSelected;

  return (
    <ControlWrapper
      {...props}
      showBorder={props.isSelected && isFormMode}
      resizable={true}
    >
      <div
        className={cn(
          "relative flex h-full w-full transition-colors",
          data.multiline ? "items-start" : "items-center",
          "overflow-hidden",
          showHelperBg && isFormMode && "bg-blue-500/10 dark:bg-blue-400/10",
          showHelperBg && isFormMode && !isSelectable && "hover:bg-blue-500/20",
          isAnnotationMode && isSelectable && "hover:bg-black/5",
          isAnnotationMode && !isSelectable && "pointer-events-none",
        )}
        style={containerStyle}
        onPointerDown={(_e) => {
          // Forward event to parent handler (which we need to wire up in Workspace)
          // For now, just stop propagation if we are selecting
          // Note: We need to call the passed in onPointerDown from props if we add it
          // props.onPointerDown?.(e);
        }}
      >
        {/* Helper Border Overlay */}
        {showHelperBorder && isFormMode && (
          <div
            className="pointer-events-none absolute inset-0 border border-dashed border-blue-400/50"
            style={{ zIndex: 1 }}
          />
        )}

        {data.multiline ? (
          <textarea
            readOnly={isFormMode || data.readOnly}
            tabIndex={isFormMode ? -1 : undefined}
            className={cn(
              "font-inherit block h-full w-full resize-none border-none bg-transparent leading-tight text-inherit outline-none",
              (isFormMode || !isSelectable) && "pointer-events-none",
            )}
            style={{
              textAlign: data.alignment,
              padding: "calc(var(--spacing) * var(--scale, 1))",
            }}
            value={
              isFormMode
                ? data.value || data.defaultValue || data.name
                : data.value || ""
            }
            placeholder={isAnnotationMode ? data.name : undefined}
            onChange={(e) => onUpdate(data.id, { value: e.target.value })}
            onPointerDown={(e) => e.stopPropagation()}
            onFocus={() => {
              if (isAnnotationMode) onSelect(data.id);
            }}
          />
        ) : (
          <input
            type="text"
            readOnly={isFormMode || data.readOnly}
            tabIndex={isFormMode ? -1 : undefined}
            className={cn(
              "font-inherit h-full w-full border-none bg-transparent leading-tight text-inherit outline-none",
              (isFormMode || !isSelectable) && "pointer-events-none",
            )}
            style={{
              textAlign: data.alignment,
              paddingInline: "calc(var(--spacing) * var(--scale, 1))",
            }}
            value={
              isFormMode
                ? data.value || data.defaultValue || data.name
                : data.value || ""
            }
            placeholder={isAnnotationMode ? data.name : undefined}
            onChange={(e) => onUpdate(data.id, { value: e.target.value })}
            onPointerDown={(e) => e.stopPropagation()}
            onFocus={() => {
              if (isAnnotationMode) onSelect(data.id);
            }}
          />
        )}
      </div>
    </ControlWrapper>
  );
};
