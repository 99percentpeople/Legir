import React from "react";
import { ChevronDown } from "lucide-react";
import { isListBoxField } from "@legir/pdf-model/choiceFields";
import { FormControlProps } from "../types";
import { ControlWrapper } from "../ControlWrapper";
import { cn } from "@/utils/cn";
import { resolveFormControlFontFamilyCss } from "@legir/pdf-model/fonts";
import { useLanguage } from "@/components/language-provider";

export const DropdownControl: React.FC<FormControlProps> = (props) => {
  const {
    data,
    isFormMode,
    isAnnotationMode,
    isSelectable,
    canFillFormValue = true,
    onUpdate,
    onSelect,
  } = props;
  const { t } = useLanguage();
  const style = data.style || {};
  const options = data.options ?? [];
  const listBox = isListBoxField(data);
  const canFill =
    !!isAnnotationMode && !!isSelectable && canFillFormValue && !data.readOnly;
  const displayedValue = data.value || t("common.select");
  const values = new Set(
    data.isMultiSelect ? (data.value ?? "").split("\n") : [data.value],
  );
  const selectedKeys = new Set(
    options.flatMap((option, index) =>
      values.has(option) &&
      (data.isMultiSelect || options.indexOf(option) === index)
        ? [String(index)]
        : [],
    ),
  );
  const listBoxRef = React.useRef<HTMLSelectElement>(null);
  React.useLayoutEffect(() => {
    // React falls back to the first option when a single select has no matching value.
    // PDF lists can have no selection, including after clearing or removing an option.
    if (listBoxRef.current && !data.isMultiSelect && selectedKeys.size === 0) {
      listBoxRef.current.selectedIndex = -1;
    }
  });
  const setValue = (value: string) => {
    if (!canFill || value === (data.value ?? "")) return;
    props.onTriggerHistorySave?.();
    onUpdate(data.id, { value });
  };
  const containerStyle: React.CSSProperties = {
    backgroundColor: !style.isTransparent ? style.backgroundColor : undefined,
    borderWidth: `calc(${style.borderWidth ?? 1}px * var(--scale, 1))`,
    borderColor: style.borderColor,
    borderStyle: style.borderStyle === "dashed" ? "dashed" : "solid",
    ...(style.borderStyle === "underline"
      ? { borderTopWidth: 0, borderLeftWidth: 0, borderRightWidth: 0 }
      : {}),
    color: style.textColor,
    fontSize: `calc(${style.fontSize || 12}px * var(--scale, 1))`,
    fontFamily: resolveFormControlFontFamilyCss(
      style.fontFamily,
      listBox ? options.join("\n") : displayedValue,
    ),
    boxSizing: "border-box",
  };
  const showHelperBorder = (style.borderWidth ?? 1) === 0 && !props.isSelected;
  const showHelperBg = style.isTransparent && !props.isSelected;

  return (
    <ControlWrapper
      {...props}
      showBorder={props.isSelected && isFormMode}
      resizable
    >
      <div
        className={cn(
          "relative flex h-full w-full items-center overflow-hidden transition-colors",
          showHelperBg && isFormMode && "bg-blue-500/10 dark:bg-blue-400/10",
          canFill && "hover:bg-black/5",
          isAnnotationMode && !isSelectable && "pointer-events-none",
          isFormMode && "pointer-events-none",
        )}
        style={containerStyle}
        title={data.toolTip}
      >
        {showHelperBorder && isFormMode && (
          <div className="pointer-events-none absolute inset-0 z-10 border border-dashed border-blue-400/50" />
        )}
        {listBox ? (
          <select
            ref={listBoxRef}
            aria-label={data.toolTip || data.name}
            className="m-0 h-full w-full rounded-none border-0 bg-transparent p-0 text-inherit outline-none disabled:opacity-100"
            style={{ font: "inherit" }}
            size={Math.max(2, options.length)}
            multiple={!!data.isMultiSelect}
            disabled={!canFill}
            value={
              data.isMultiSelect
                ? [...selectedKeys]
                : ([...selectedKeys][0] ?? "")
            }
            onChange={(event) => {
              const selected = Array.from(
                event.currentTarget.selectedOptions,
                (option) => options[Number(option.value)],
              );
              setValue(
                data.isMultiSelect
                  ? [...new Set(selected)].join("\n")
                  : (selected[0] ?? ""),
              );
            }}
            onFocus={() => {
              if (canFill) onSelect(data.id);
            }}
            onPointerDown={(event) => {
              if (canFill) event.stopPropagation();
            }}
          >
            {options.map((option, index) => (
              <option key={index} value={String(index)}>
                {option || "\u00a0"}
              </option>
            ))}
          </select>
        ) : (
          <>
            <div className="flex w-full items-center justify-between px-1">
              <span className="truncate">{displayedValue}</span>
              <ChevronDown size={12} className="shrink-0" aria-hidden="true" />
            </div>
            {isAnnotationMode && (
              <select
                aria-label={data.toolTip || data.name}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                value={data.value || ""}
                disabled={!canFill}
                onChange={(event) => setValue(event.target.value)}
                onPointerDown={(event) => event.stopPropagation()}
                onFocus={() => {
                  if (canFill) onSelect(data.id);
                }}
              >
                <option value="" disabled>
                  {t("common.select")}
                </option>
                {options.map((option, index) => (
                  <option key={index} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
      </div>
    </ControlWrapper>
  );
};
