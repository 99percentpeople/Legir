import React from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export const dispatchSyntheticContextMenuEscape = () => {
  if (typeof document === "undefined") return;
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
};

export const isContextMenuContentTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      '[data-slot="context-menu-content"], [data-slot="context-menu-sub-content"]',
    ),
  );
};

type ControlContextMenuProps = {
  disabled?: boolean;
  children: React.ReactNode;
  content: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
};

export const ControlContextMenu: React.FC<ControlContextMenuProps> = ({
  disabled = false,
  children,
  content,
  onOpenChange,
}) => {
  if (disabled) return <>{children}</>;

  return (
    <ContextMenu modal={false} onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        className="z-50 min-w-40"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {content}
      </ContextMenuContent>
    </ContextMenu>
  );
};
