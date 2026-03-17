import { cn } from "@/utils/cn";

export const StreamingCursor = ({ className }: { className?: string }) => (
  <span
    aria-hidden="true"
    className={cn(
      "text-muted-foreground animation-duration-[.5s] inline-block animate-pulse",
      className,
    )}
  >
    ⬤
  </span>
);
