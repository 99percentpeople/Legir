import React from "react";
import type { LLMModelCapabilities } from "@/types";

import { ProviderLogo } from "@/components/ProviderLogo";
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
import { isAiProviderId } from "@/services/ai/providers/catalog";
import { ModelCapabilityBadges } from "@/components/ModelCapabilityBadges";
import { cn } from "@/utils/cn";

export type ModelSelectOption = {
  value: string;
  label: string;
  capabilities?: LLMModelCapabilities;
  disabled?: boolean;
};

export type ModelSelectGroup = {
  id: string;
  label: string;
  options: ModelSelectOption[];
};

export type ModelSelectOptionFilter = (
  option: ModelSelectOption,
  group: ModelSelectGroup,
) => boolean;

export const filterModelSelectGroups = (
  groups: ModelSelectGroup[],
  optionFilter?: ModelSelectOptionFilter,
) => {
  const nextGroups = optionFilter
    ? groups.map((group) => ({
        ...group,
        options: group.options.filter((option) => optionFilter(option, group)),
      }))
    : groups;

  return nextGroups.filter((group) => group.options.length > 0);
};

export function ModelSelect(props: {
  value: string | undefined;
  onValueChange: (value: string) => void;
  placeholder: string;
  groups: ModelSelectGroup[];
  optionFilter?: ModelSelectOptionFilter;
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
    optionFilter,
    disabled,
    triggerClassName,
    triggerSize,
    triggerTitle,
    showSeparators = true,
  } = props;
  const visibleGroups = filterModelSelectGroups(groups, optionFilter);
  const selectedOption = visibleGroups
    .flatMap((group) => group.options)
    .find((option) => option.value === value);

  return (
    <Select value={value} onValueChange={(v) => onValueChange(v)}>
      <SelectTrigger
        disabled={disabled}
        className={cn("max-w-full min-w-0", triggerClassName)}
        size={triggerSize}
        title={triggerTitle}
      >
        <SelectValue placeholder={placeholder}>
          {selectedOption?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {visibleGroups.map((group, idx) => (
          <React.Fragment key={group.id}>
            <SelectGroup>
              <SelectLabel className="flex items-center gap-1.5">
                {isAiProviderId(group.id) ? (
                  <ProviderLogo
                    providerId={group.id}
                    size={12}
                    className="text-foreground/80"
                  />
                ) : null}
                <span>{group.label}</span>
              </SelectLabel>
              {group.options.map((opt) => (
                <SelectItem
                  key={opt.value}
                  value={opt.value}
                  disabled={opt.disabled}
                  itemText={opt.label}
                  className="py-1.5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2 py-0.5">
                    <div className="min-w-0 flex-1 text-xs">{opt.label}</div>
                    <ModelCapabilityBadges
                      capabilities={opt.capabilities}
                      className="shrink-0 flex-nowrap"
                    />
                  </div>
                </SelectItem>
              ))}
            </SelectGroup>
            {showSeparators && idx < visibleGroups.length - 1 ? (
              <SelectSeparator />
            ) : null}
          </React.Fragment>
        ))}
      </SelectContent>
    </Select>
  );
}
