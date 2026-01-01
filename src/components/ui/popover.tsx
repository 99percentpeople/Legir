import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/cn";

const ensureGlobalPopoverCtrlWheelInterceptor = () => {
  if (typeof window === "undefined") return;

  const key = "__ff_popover_ctrl_wheel_interceptor_installed__";
  if (window[key]) return;
  window[key] = true;

  const handler = (e: WheelEvent) => {
    if (e.defaultPrevented) return;
    if (!(e.ctrlKey || e.metaKey)) return;

    const target = e.target;
    if (!(target instanceof Element)) return;

    const contentEl = target.closest(
      '[data-slot="popover-content"]',
    ) as HTMLElement | null;
    if (!contentEl) return;

    // Critical: prevent browser zoom when ctrl/meta+wheel happens over popovers.
    e.preventDefault();
    e.stopPropagation();

    window.dispatchEvent(
      new CustomEvent("ff-ctrl-wheel", {
        detail: {
          deltaY: e.deltaY,
          clientX: e.clientX,
          clientY: e.clientY,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          contentId: contentEl.id,
        },
      }),
    );
  };

  window.addEventListener("wheel", handler, {
    passive: false,
    capture: true,
  });
};

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(
  (
    { className, align = "center", sideOffset = 4, onWheelCapture, ...props },
    ref,
  ) => {
    React.useEffect(() => {
      ensureGlobalPopoverCtrlWheelInterceptor();
    }, []);

    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={ref}
          data-slot="popover-content"
          align={align}
          sideOffset={sideOffset}
          onWheelCapture={onWheelCapture}
          className={cn(
            "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border p-4 shadow-md outline-hidden",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Portal>
    );
  },
);
PopoverContent.displayName = "PopoverContent";

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
