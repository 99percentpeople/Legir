import { Loader2Icon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";

const spinnerVariants = cva("animate-spin", {
  variants: {
    size: {
      sm: "size-4",
      md: "size-6",
      lg: "size-8",
      xl: "size-12",
    },
  },
  defaultVariants: {
    size: "sm",
  },
});

function Spinner({
  className,
  size = "sm",
  style,
  ...props
}: React.ComponentProps<"svg"> &
  VariantProps<typeof spinnerVariants> & {
    size?: "sm" | "md" | "lg" | "xl" | number;
  }) {
  const isNumericSize = typeof size === "number";
  const numericStyle = isNumericSize
    ? {
        width: size,
        height: size,
      }
    : null;

  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn(
        spinnerVariants({ size: isNumericSize ? undefined : size }),
        className,
      )}
      style={{
        ...style,
        ...numericStyle,
      }}
      {...props}
    />
  );
}

export { Spinner };
