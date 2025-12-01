import React from 'react';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import {
  Button,
  Group,
  Input,
  Label,
  NumberField,
  NumberFieldProps
} from 'react-aria-components';
import { cn } from '../../lib/utils';

export interface NumberInputProps extends Omit<NumberFieldProps, 'onChange'> {
  className?: string;
  label?: string;
  onChange?: (value: number) => void;
}

export function NumberInput({ className, label, onChange, ...props }: NumberInputProps) {
  return (
    <NumberField
      {...props}
      onChange={onChange}
      className={cn("w-full gap-1.5", className)}
    >
      {label && <Label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 mb-1.5 block">{label}</Label>}
      <Group className="relative inline-flex h-9 w-full items-center overflow-hidden whitespace-nowrap rounded-md border border-input text-sm shadow-xs outline-none transition-[color,box-shadow] data-focus-within:border-ring data-disabled:opacity-50 data-focus-within:ring-[3px] data-focus-within:ring-ring/50 data-focus-within:has-aria-invalid:border-destructive data-focus-within:has-aria-invalid:ring-destructive/20 dark:data-focus-within:has-aria-invalid:ring-destructive/40 bg-background">
        <Input className="flex-1 min-w-0 bg-transparent px-3 py-2 text-foreground tabular-nums outline-none" />
        <div className="flex flex-col border-l border-input shrink-0 h-full w-6">
          <Button
            slot="increment"
            className="flex-1 flex items-center justify-center bg-transparent text-muted-foreground/80 text-sm hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer border-b border-input"
          >
            <ChevronUpIcon aria-hidden="true" size={12} />
          </Button>
          <Button
            slot="decrement"
            className="flex-1 flex items-center justify-center bg-transparent text-muted-foreground/80 text-sm hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            <ChevronDownIcon aria-hidden="true" size={12} />
          </Button>
        </div>
      </Group>
    </NumberField>
  );
}