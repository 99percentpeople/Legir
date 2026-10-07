import { useEffect, useRef } from "react";
import { type AppEventMap, type Unsubscribe } from "@/lib/eventBus";
import { useEditorEventBus } from "@/app/editorTabs/context";

export const useAppEvent = <K extends keyof AppEventMap>(
  event: K,
  handler: (payload: AppEventMap[K]) => void,
  options?: { replayLast?: boolean },
) => {
  const appEventBus = useEditorEventBus();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    let unsub: Unsubscribe | null = null;

    unsub = appEventBus.on(
      event,
      (payload) => {
        handlerRef.current(payload);
      },
      options,
    );

    return () => {
      try {
        unsub?.();
      } catch {
        // ignore
      }
    };
  }, [appEventBus, event, options?.replayLast]);
};
