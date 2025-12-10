import React from "react";
import { cn } from "@/lib/utils";

export interface FloatingToolbarProps {
  isVisible: boolean;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const FloatingToolbar: React.FC<FloatingToolbarProps> = ({
  isVisible,
  children,
  className,
  style,
}) => {
  if (!isVisible) return null;

  return (
    <div
      className={cn(
        "bg-background absolute bottom-full left-1/2 z-60 mb-2 flex -translate-x-1/2 items-center gap-1 rounded-md border p-1 shadow-md",
        className,
      )}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
};
