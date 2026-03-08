import React from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/utils/cn";

export type ModelSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type ModelSelectGroup = {
  id: string;
  label: string;
  options: ModelSelectOption[];
};

export function ModelSelect(props: {
  value: string | undefined;
  onValueChange: (value: string) => void;
  placeholder: string;
  groups: ModelSelectGroup[];
  disabled?: boolean;
  triggerClassName?: string;
  triggerSize?: "sm" | "default";
  triggerTitle?: string;
  showSeparators?: boolean;
}) {
  const {
    value,
    onValueChange,
    placeholder,
    groups,
    disabled,
    triggerClassName,
    triggerSize,
    triggerTitle,
    showSeparators = true,
  } = props;

  return (
    <Select value={value} onValueChange={(v) => onValueChange(v)}>
      <SelectTrigger
        disabled={disabled}
        className={cn("max-w-full min-w-0", triggerClassName)}
        size={triggerSize}
        title={triggerTitle}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {groups.map((group, idx) => (
          <React.Fragment key={group.id}>
            <SelectGroup>
              <SelectLabel>{group.label}</SelectLabel>
              {group.options.map((opt) => (
                <SelectItem
                  key={opt.value}
                  value={opt.value}
                  disabled={opt.disabled}
                >
                  {opt.label}
                </SelectItem>
              ))}
            </SelectGroup>
            {showSeparators && idx < groups.length - 1 ? (
              <SelectSeparator />
            ) : null}
          </React.Fragment>
        ))}
      </SelectContent>
    </Select>
  );
}
