import React from "react";
import { ChevronDown, Check } from "lucide-react";
import { ListBox, ListBoxItem } from "react-aria-components";
import { FormControlProps } from "../types";
import { ControlWrapper } from "../ControlWrapper";
import { cn } from "@/lib/cn";
import { resolveFormControlFontFamilyCss } from "@/lib/fonts";

export const DropdownControl: React.FC<FormControlProps> = (props) => {
  const {
    data,
    isFormMode,
    isAnnotationMode,
    isSelectable,
    onUpdate,
    onSelect,
    scale,
  } = props;
  const style = data.style || {};

  const displayedValue = data.isMultiSelect
    ? data.value
      ? data.value.split("\n").join(", ")
      : "Select..."
    : data.value || "Select...";

  const effectiveBorderStyle =
    style.borderStyle === "dashed"
      ? "dashed"
      : style.borderStyle === "underline"
        ? "solid"
        : "solid";

  const containerStyle: React.CSSProperties = {
    "--scale": scale,
    backgroundColor: !style.isTransparent ? style.backgroundColor : undefined,
    borderWidth: style.borderWidth,
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
          "relative flex h-full w-full items-center transition-colors",
          "overflow-hidden",
          showHelperBg &&
            isFormMode &&
            cn(
              "bg-blue-500/10 dark:bg-blue-400/10",
              !isSelectable && "hover:bg-blue-500/20",
            ),
          isAnnotationMode && isSelectable && "hover:bg-black/5",
          isAnnotationMode && !isSelectable && "pointer-events-none",
          isFormMode && isSelectable && "pointer-events-none",
        )}
        style={containerStyle}
      >
        {/* Helper Border Overlay */}
        {showHelperBorder && isFormMode && (
          <div
            className="pointer-events-none absolute inset-0 border border-dashed border-blue-400/50"
            style={{ zIndex: 1 }}
          />
        )}

        {(!data.isMultiSelect || !isAnnotationMode) && (
          <div className="flex w-full items-center justify-between px-1">
            <span className="truncate">
              {data.isMultiSelect
                ? data.value
                  ? data.value.split("\n").join(", ")
                  : "Select..."
                : data.value || "Select..."}
            </span>
            <ChevronDown size={12} className="shrink-0" />
          </div>
        )}
        <div
          className={cn(
            "absolute inset-0 flex h-full w-full items-center",
            isAnnotationMode ? "z-10" : "hidden",
          )}
        >
          {isAnnotationMode && (
            <>
              {data.isMultiSelect ? (
                <ListBox
                  aria-describedby={data.toolTip || ""}
                  className="font-inherit h-full w-full space-y-0.5 overflow-auto bg-transparent p-1 text-inherit outline-none"
                  selectionMode="multiple"
                  selectedKeys={
                    new Set(data.value ? data.value.split("\n") : [])
                  }
                  onSelectionChange={(keys) => {
                    const vals = Array.from(keys).map((k) => String(k));
                    onUpdate(data.id, { value: vals.join("\n") });
                  }}
                  aria-label={data.toolTip || "Multi-select dropdown"}
                >
                  {(data.options || []).map((opt, i) => (
                    <ListBoxItem
                      aria-describedby={data.toolTip || ""}
                      key={i}
                      id={opt}
                      textValue={opt}
                      className={({ isSelected }) =>
                        cn(
                          "data-focus-visible:border-ring data-focus-visible:ring-ring/50 flex w-full cursor-pointer items-center justify-between rounded px-1 outline-none hover:bg-black/5 data-focus-visible:ring-[3px]",
                          isSelected ? "bg-black/10 font-medium" : "",
                        )
                      }
                    >
                      {({ isSelected }) => (
                        <>
                          <span className="flex-1 truncate text-left">
                            {opt}
                          </span>
                          {isSelected && (
                            <Check size={12} className="ml-1 shrink-0" />
                          )}
                        </>
                      )}
                    </ListBoxItem>
                  ))}
                </ListBox>
              ) : (
                <select
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  value={data.value || ""}
                  onChange={(e) => onUpdate(data.id, { value: e.target.value })}
                  onPointerDown={(e) => e.stopPropagation()}
                  onFocus={() => {
                    if (isAnnotationMode) onSelect(data.id);
                  }}
                  title={data.toolTip}
                >
                  <option value="" disabled>
                    Select...
                  </option>
                  {(data.options || []).map((opt, i) => (
                    <option key={i} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
        </div>
      </div>
    </ControlWrapper>
  );
};
