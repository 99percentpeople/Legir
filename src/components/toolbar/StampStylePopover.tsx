import React from "react";

import { useAppEvent } from "@/hooks/useAppEventBus";
import { useWorkspacePointerDownDismiss } from "@/lib/workspacePointerDownDismissContext";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  StampStyleEditor,
  type StampStyleEditorValue,
} from "@/components/stamps/StampStyleEditor";

interface StampStylePopoverProps {
  value: StampStyleEditorValue | undefined;
  onChange: (updates: Partial<StampStyleEditorValue>) => void;
  onInteractionStart?: () => void;
  title: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  children: React.ReactNode;
}

export const StampStylePopover: React.FC<StampStylePopoverProps> = ({
  value,
  onChange,
  onInteractionStart,
  title,
  side = "bottom",
  align = "center",
  children,
}) => {
  const inheritedCloseOnWorkspacePointerDown = useWorkspacePointerDownDismiss();
  const [open, setOpen] = React.useState(false);

  useAppEvent("workspace:pointerDown", () => {
    if (!inheritedCloseOnWorkspacePointerDown) return;
    setOpen(false);
  });

  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-80 p-3"
        side={side}
        align={align}
        data-app-block-modifier-wheel-zoom="1"
      >
        <div className="sr-only">{title}</div>
        <StampStyleEditor
          value={value}
          onChange={onChange}
          onInteractionStart={onInteractionStart}
        />
      </PopoverContent>
    </Popover>
  );
};
