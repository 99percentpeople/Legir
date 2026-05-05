import React from "react";
import { FormControlProps } from "../types";
import { ControlWrapper } from "../ControlWrapper";
import { cn } from "@/utils/cn";
import {
  DEFAULT_FORM_TEXT_VISUAL_CENTER_ABOVE_BASELINE_EM,
  resolveFormControlFontFamilyCss,
} from "@/lib/fonts";
import { measureCssTextVisualCenterAboveBaselineEm } from "../../lib/formTextMetrics";

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
  const fontFamily = resolveFormControlFontFamilyCss(
    style.fontFamily,
    displayedValue,
  );
  const [visualCenterAboveBaselineEm, setVisualCenterAboveBaselineEm] =
    React.useState(DEFAULT_FORM_TEXT_VISUAL_CENTER_ABOVE_BASELINE_EM);
  const textAnchor =
    data.alignment === "center"
      ? "middle"
      : data.alignment === "right"
        ? "end"
        : "start";
  const textX =
    data.alignment === "center"
      ? "50%"
      : data.alignment === "right"
        ? "100%"
        : "0";

  React.useEffect(() => {
    if (!isFormMode || data.multiline) return;

    let cancelled = false;
    const updateMetrics = () => {
      const measured = measureCssTextVisualCenterAboveBaselineEm(
        displayedValue,
        fontFamily,
      );
      if (cancelled) return;
      setVisualCenterAboveBaselineEm(
        measured ?? DEFAULT_FORM_TEXT_VISUAL_CENTER_ABOVE_BASELINE_EM,
      );
    };

    updateMetrics();
    void document.fonts?.ready.then(updateMetrics).catch(() => {
      // The initial measurement is still a valid fallback.
    });

    return () => {
      cancelled = true;
    };
  }, [data.multiline, displayedValue, fontFamily, isFormMode]);

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
    fontFamily,
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

        {isFormMode && !data.multiline ? (
          <div
            className="pointer-events-none h-full w-full overflow-hidden"
            style={{
              boxSizing: "border-box",
              paddingInline: "calc(1px * var(--scale, 1))",
            }}
          >
            <svg
              aria-hidden="true"
              className="block h-full w-full overflow-hidden"
              focusable="false"
              style={{
                fontFamily: "inherit",
                fontSize: "inherit",
              }}
            >
              <text
                x={textX}
                y="50%"
                dy={`${visualCenterAboveBaselineEm}em`}
                dominantBaseline="alphabetic"
                textAnchor={textAnchor}
                style={{
                  fill: "currentColor",
                  fontFamily: "inherit",
                  letterSpacing: 0,
                }}
              >
                {displayedValue}
              </text>
            </svg>
          </div>
        ) : data.multiline ? (
          <textarea
            readOnly={isFormMode || data.readOnly}
            tabIndex={isFormMode ? -1 : undefined}
            className={cn(
              "no-scrollbar font-inherit block h-full w-full resize-none overflow-hidden border-none bg-transparent leading-tight text-inherit outline-none",
              (isFormMode || !isSelectable) && "pointer-events-none",
            )}
            style={{
              boxSizing: "border-box",
              textAlign: data.alignment,
              padding: "calc(1px * var(--scale, 1))",
            }}
            value={
              isFormMode
                ? data.value || data.defaultValue || data.name
                : data.value || ""
            }
            placeholder={isAnnotationMode ? data.placeholder : undefined}
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
              "no-scrollbar font-inherit w-full overflow-hidden border-none bg-transparent leading-none text-inherit outline-none",
              (isFormMode || !isSelectable) && "pointer-events-none",
            )}
            style={{
              boxSizing: "border-box",
              height: "auto",
              lineHeight: 1,
              paddingBlock: 0,
              textAlign: data.alignment,
              paddingInline: "calc(1px * var(--scale, 1))",
            }}
            value={
              isFormMode
                ? data.value || data.defaultValue || data.name
                : data.value || ""
            }
            placeholder={isAnnotationMode ? data.placeholder : undefined}
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
