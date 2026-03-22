import React from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

type ControlContextMenuProps = {
  disabled?: boolean;
  children: React.ReactNode;
  content: React.ReactNode;
};

export const ControlContextMenu: React.FC<ControlContextMenuProps> = ({
  disabled = false,
  children,
  content,
}) => {
  if (disabled) return <>{children}</>;

  return (
    <ContextMenu modal={false}>
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
