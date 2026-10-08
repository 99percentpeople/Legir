import React from "react";
import { useAppEvent } from "@/hooks/useAppEventBus";

export function useEditorPageLifecycle() {
  const workspaceScrollContainerRef = React.useRef<HTMLElement | null>(null);
  useAppEvent(
    "workspace:scrollContainerReady",
    ({ element }) => {
      workspaceScrollContainerRef.current = element;
    },
    { replayLast: true },
  );
  return { workspaceScrollContainerRef };
}
