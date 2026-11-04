import React from "react";
import { ChevronDown, Check } from "lucide-react";
import { ListBox, ListBoxItem } from "react-aria-components";
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
          <ListBox
            aria-label={data.toolTip || data.name}
            className="h-full w-full space-y-0.5 overflow-auto bg-transparent p-1 text-inherit outline-none"
            style={{ font: "inherit" }}
            selectionMode={data.isMultiSelect ? "multiple" : "single"}
            selectionBehavior={data.isMultiSelect ? "toggle" : "replace"}
            disabledKeys={
              canFill ? [] : options.map((_, index) => String(index))
            }
            selectedKeys={selectedKeys}
            onSelectionChange={(keys) => {
              const selected = options.filter(
                (_, index) => keys === "all" || keys.has(String(index)),
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
              <ListBoxItem
                key={index}
                id={String(index)}
                textValue={option || " "}
                className={({ isSelected }) =>
                  cn(
                    "data-focus-visible:ring-ring/50 flex w-full items-center justify-between rounded px-1 outline-none data-focus-visible:ring-2",
                    canFill && "cursor-pointer hover:bg-black/5",
                    isSelected && "bg-black/10 font-medium",
                  )
                }
              >
                {({ isSelected }) => (
                  <>
                    <span className="min-w-0 flex-1 truncate text-left">
                      {option || "\u00a0"}
                    </span>
                    {isSelected && (
                      <Check
                        size={12}
                        className="ml-1 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  </>
                )}
              </ListBoxItem>
            ))}
          </ListBox>
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
