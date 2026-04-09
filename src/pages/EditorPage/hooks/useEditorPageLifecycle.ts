import React from "react";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useEventListener } from "@/hooks/useEventListener";
import { setPlatformWindowTitle } from "@/services/platform";

interface UseEditorPageLifecycleOptions {
  filename: string;
  pagesLength: number;
  hasDirtyTabs: boolean;
}

export function useEditorPageLifecycle({
  filename,
  pagesLength,
  hasDirtyTabs,
}: UseEditorPageLifecycleOptions) {
  const workspaceScrollContainerRef = React.useRef<HTMLElement | null>(null);
  const initialTitleRef = React.useRef<string | null>(null);

  useAppEvent(
    "workspace:scrollContainerReady",
    ({ element }) => {
      workspaceScrollContainerRef.current = element;
    },
    { replayLast: true },
  );

  React.useEffect(() => {
    const appName = process.env.APP_NAME ?? "Legir";

    if (typeof document !== "undefined" && initialTitleRef.current === null) {
      initialTitleRef.current = document.title;
    }

    const hasOpenDocument = pagesLength > 0;
    const nextTitle = hasOpenDocument
      ? `${filename || appName} - ${appName}`
      : appName;

    void setPlatformWindowTitle(nextTitle).catch(() => {
      // ignore
    });

    return () => {
      void setPlatformWindowTitle(initialTitleRef.current ?? appName).catch(
        () => {
          // ignore
        },
      );
    };
  }, [filename, pagesLength]);

  useEventListener<BeforeUnloadEvent>(
    typeof window !== "undefined" ? window : null,
    "beforeunload",
    (event) => {
      if (pagesLength > 0 && hasDirtyTabs) {
        event.preventDefault();
        event.returnValue = "";
      }
    },
  );

  return {
    workspaceScrollContainerRef,
  };
}
