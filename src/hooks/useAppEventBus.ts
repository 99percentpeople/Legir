import { useEffect, useRef } from "react";
import {
  appEventBus,
  type AppEventMap,
  type Unsubscribe,
} from "@/lib/eventBus";

export const useAppEvent = <K extends keyof AppEventMap>(
  event: K,
  handler: (payload: AppEventMap[K]) => void,
  options?: { replayLast?: boolean },
) => {
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
  }, [event, options?.replayLast]);
};
