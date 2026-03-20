import React, { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface FloatingToolbarProps {
  isVisible: boolean;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  sideOffset?: number;
}

export const FloatingToolbar: React.FC<FloatingToolbarProps> = ({
  isVisible,
  children,
  className,
  style,
  sideOffset,
}) => {
  if (!isVisible) return null;

  const [isTransforming, setIsTransforming] = useState(() => {
    if (typeof document === "undefined") return false;
    return document.body.dataset.ffControlTransforming === "1";
  });
  const [open, setOpen] = useState(() => !isTransforming);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ active?: boolean }>;
      setIsTransforming(!!ce.detail?.active);
    };
    window.addEventListener(
      "ff-control-transforming",
      handler as EventListener,
    );
    return () => {
      window.removeEventListener(
        "ff-control-transforming",
        handler as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    setOpen(!isTransforming);
  }, [isTransforming, isVisible]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-full left-1/2 h-px w-px -translate-x-1/2 opacity-0"
        />
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="center"
        sideOffset={sideOffset ?? 8}
        className={cn(
          "bg-background z-50 flex w-auto flex-row items-center gap-1 rounded-md border p-1 shadow-md",
          className,
        )}
        style={style}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
};
