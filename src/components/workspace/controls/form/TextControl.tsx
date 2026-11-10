import React from "react";
import { FormControlProps } from "../types";
import { ControlWrapper } from "../ControlWrapper";
import { cn } from "@/utils/cn";
import {
  DEFAULT_FORM_TEXT_VISUAL_CENTER_ABOVE_BASELINE_EM,
  resolveFormControlFontFamilyCss,
} from "@legir/pdf-model/fonts";
import { measureCssTextMetrics } from "../../lib/formTextMetrics";

export const TextControl: React.FC<FormControlProps> = (props) => {
  const {
    data,
    isFormMode,
    isAnnotationMode,
    isSelectable,
    canFillFormValue = true,
    onUpdate,
    onSelect,
  } = props;
  const style = data.style || {};
  const canFill = isAnnotationMode && canFillFormValue && !data.readOnly;
  const maxLength =
    data.maxLength && data.maxLength > 0 ? data.maxLength : undefined;

  const displayedValue = isFormMode
    ? data.value || data.defaultValue || data.name
    : data.value || "";
  const fontFamily = resolveFormControlFontFamilyCss(
    style.fontFamily,
    displayedValue,
  );
  const [textMetrics, setTextMetrics] = React.useState({
    ascent: DEFAULT_FORM_TEXT_VISUAL_CENTER_ABOVE_BASELINE_EM * 2,
    descent: 0,
  });
  const verticalAlignment =
    data.verticalAlignment ?? (data.multiline ? "top" : "middle");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !data.verticalAlignment) return;
    let cancelled = false;
    const update = () => {
      if (cancelled) return;
      // Measure natural wrapped content without the full-height textarea masking it.
      const previousScroll = textarea.scrollTop;
      textarea.style.paddingTop = "calc(1px * var(--scale, 1))";
      textarea.style.height = "0px";
      const contentHeight = textarea.scrollHeight;
      textarea.style.height = "100%";
      const freeSpace = Math.max(0, textarea.clientHeight - contentHeight);
      const offset =
        verticalAlignment === "bottom"
          ? freeSpace
          : verticalAlignment === "middle"
            ? freeSpace / 2
            : 0;
      textarea.style.paddingTop = `calc(1px * var(--scale, 1) + ${offset}px)`;
      textarea.scrollTop = previousScroll;
    };
    update();
    const observer = new ResizeObserver(update);
    if (textarea.parentElement) observer.observe(textarea.parentElement);
    void document.fonts?.ready.then(update);
    document.fonts?.addEventListener("loadingdone", update);
    return () => {
      cancelled = true;
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", update);
      textarea.style.paddingTop = "calc(1px * var(--scale, 1))";
    };
  }, [
    data.verticalAlignment,
    verticalAlignment,
    displayedValue,
    data.placeholder,
    data.multiline,
    fontFamily,
    style.fontSize,
    style.borderWidth,
  ]);
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
      const measured = measureCssTextMetrics(displayedValue, fontFamily);
      if (cancelled) return;
      if (measured) setTextMetrics(measured);
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
    cursor:
      isAnnotationMode && isSelectable && props.isSelected ? "text" : "inherit",
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
          verticalAlignment === "top"
            ? "items-start"
            : verticalAlignment === "bottom"
              ? "items-end"
              : "items-center",
          "overflow-hidden",
          showHelperBg && isFormMode && "bg-blue-500/10 dark:bg-blue-400/10",
          showHelperBg && isFormMode && !isSelectable && "hover:bg-blue-500/20",
          isAnnotationMode && isSelectable && "hover:bg-black/5",
          isAnnotationMode && !isSelectable && "pointer-events-none",
        )}
        style={containerStyle}
        onPointerDown={(e) => {
          if (e.button !== 0 || !isAnnotationMode || !isSelectable) return;

          const input = e.currentTarget.querySelector<
            HTMLInputElement | HTMLTextAreaElement
          >("input, textarea");
          if (!input) return;

          // Treat the border and unused field height as part of the input.
          // Prevent the default pointer action from blurring it again.
          e.preventDefault();
          e.stopPropagation();
          input.focus({ preventScroll: true });
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
              padding: "calc(1px * var(--scale, 1))",
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
                y={
                  verticalAlignment === "top"
                    ? "0%"
                    : verticalAlignment === "bottom"
                      ? "100%"
                      : "50%"
                }
                dy={`${verticalAlignment === "top" ? textMetrics.ascent : verticalAlignment === "bottom" ? -textMetrics.descent : (textMetrics.ascent - textMetrics.descent) / 2}em`}
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
            ref={textareaRef}
            readOnly={!canFill}
            maxLength={maxLength}
            tabIndex={isFormMode ? -1 : undefined}
            className={cn(
              "no-scrollbar font-inherit block h-full w-full cursor-[inherit] resize-none overflow-hidden border-none bg-transparent leading-tight text-inherit outline-none",
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
            onChange={(e) => {
              if (canFill) onUpdate(data.id, { value: e.target.value });
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onFocus={() => {
              if (isAnnotationMode) onSelect(data.id);
            }}
          />
        ) : (
          <input
            type="text"
            readOnly={!canFill}
            maxLength={maxLength}
            tabIndex={isFormMode ? -1 : undefined}
            className={cn(
              "no-scrollbar font-inherit w-full cursor-[inherit] overflow-hidden border-none bg-transparent leading-none text-inherit outline-none",
              (isFormMode || !isSelectable) && "pointer-events-none",
            )}
            style={{
              boxSizing: "border-box",
              height: "auto",
              lineHeight: 1,
              paddingBlock: data.verticalAlignment
                ? "calc(1px * var(--scale, 1))"
                : 0,
              textAlign: data.alignment,
              paddingInline: "calc(1px * var(--scale, 1))",
            }}
            value={
              isFormMode
                ? data.value || data.defaultValue || data.name
                : data.value || ""
            }
            placeholder={isAnnotationMode ? data.placeholder : undefined}
            onChange={(e) => {
              if (canFill) onUpdate(data.id, { value: e.target.value });
            }}
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
