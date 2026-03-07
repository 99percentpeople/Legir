import { cn } from "@/utils/cn";
import { Loader2Icon } from "lucide-react";

const spinnerSizeClasses = {
  sm: "size-3",
  default: "size-4",
  lg: "size-6",
  xl: "size-8",
} as const;

type SpinnerProps = Omit<React.ComponentProps<typeof Loader2Icon>, "size"> & {
  size?: keyof typeof spinnerSizeClasses | number;
};

function Spinner({ className, size = "default", ...props }: SpinnerProps) {
  const sizeClassName =
    typeof size === "number" ? undefined : spinnerSizeClasses[size];

  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("animate-spin", sizeClassName, className)}
      {...(typeof size === "number" ? { size } : {})}
      {...props}
    />
  );
}

export { Spinner };
