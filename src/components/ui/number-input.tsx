import React from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import {
  Button,
  Group,
  Input,
  Label,
  NumberField,
  NumberFieldProps,
} from "react-aria-components";
import { cn } from "../../lib/cn";

export interface NumberInputProps extends Omit<NumberFieldProps, "onChange"> {
  className?: string;
  label?: string;
  onChange?: (value: number) => void;
}

export function NumberInput({
  className,
  label,
  onChange,
  ...props
}: NumberInputProps) {
  return (
    <NumberField
      {...props}
      onChange={onChange}
      className={cn("w-full gap-1.5", className)}
      aria-describedby={label ? `${label}-description` : ""}
    >
      {label && (
        <Label className="mb-1.5 block text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          {label}
        </Label>
      )}
      <Group className="border-input data-focus-within:border-ring data-focus-within:ring-ring/50 data-focus-within:has-aria-invalid:border-destructive data-focus-within:has-aria-invalid:ring-destructive/20 dark:data-focus-within:has-aria-invalid:ring-destructive/40 bg-background relative inline-flex h-9 w-full items-center overflow-hidden rounded-md border text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none data-disabled:opacity-50 data-focus-within:ring-[3px]">
        <Input className="text-foreground min-w-0 flex-1 bg-transparent px-3 py-2 tabular-nums outline-none" />
        <div className="border-input flex h-full w-6 shrink-0 flex-col border-l">
          <Button
            slot="increment"
            className="text-muted-foreground/80 hover:bg-accent hover:text-foreground border-input flex flex-1 cursor-pointer items-center justify-center border-b bg-transparent text-sm disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronUpIcon aria-hidden="true" size={12} />
          </Button>
          <Button
            slot="decrement"
            className="text-muted-foreground/80 hover:bg-accent hover:text-foreground flex flex-1 cursor-pointer items-center justify-center bg-transparent text-sm disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronDownIcon aria-hidden="true" size={12} />
          </Button>
        </div>
      </Group>
    </NumberField>
  );
}
