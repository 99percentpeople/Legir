import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/utils/cn";

interface EditorRightPanelSkeletonProps {
  isFloating: boolean;
  width: number;
}

export function EditorRightPanelSkeleton({
  isFloating,
  width,
}: EditorRightPanelSkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "bg-background border-border flex h-full flex-col border-l",
        isFloating
          ? "absolute top-0 right-0 bottom-0 z-40 shadow-2xl"
          : "relative shadow-none",
      )}
      style={{ width }}
    >
      <div className="border-border bg-muted/30 flex items-center justify-between border-b px-4 py-2">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-8 w-8" />
      </div>

      <div className="flex-1 space-y-6 overflow-hidden px-2 py-4">
        <div className="space-y-3 px-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-3 px-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-20 w-full" />
        </div>
        <div className="space-y-3 px-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-4/5" />
        </div>
      </div>
    </div>
  );
}
