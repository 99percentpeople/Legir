import { useCallback, useEffect, useRef } from "react";

import { useEventListener } from "@/hooks/useEventListener";
import {
  listenForPlatformCloseRequested,
  type PlatformCloseRequestEvent,
} from "@/services/platform";

interface UsePlatformWindowSessionPersistenceOptions {
  enabled: boolean;
  isDesktop: boolean;
  hasActiveTab: boolean;
  persistCurrentTabState: () => void;
  onDesktopCloseRequested?: (event: PlatformCloseRequestEvent) => void;
}

const CAPTURE_DEDUP_WINDOW_MS = 150;

export const usePlatformWindowSessionPersistence = ({
  enabled,
  isDesktop,
  hasActiveTab,
  persistCurrentTabState,
  onDesktopCloseRequested,
}: UsePlatformWindowSessionPersistenceOptions) => {
  const lastCapturedAtRef = useRef(0);
  const hasActiveTabRef = useRef(hasActiveTab);
  const persistCurrentTabStateRef = useRef(persistCurrentTabState);
  const onDesktopCloseRequestedRef = useRef(onDesktopCloseRequested);
  const browserWindow =
    enabled && !isDesktop && typeof window !== "undefined" ? window : null;
  const browserDocument =
    enabled && !isDesktop && typeof document !== "undefined" ? document : null;

  useEffect(() => {
    hasActiveTabRef.current = hasActiveTab;
  }, [hasActiveTab]);

  useEffect(() => {
    persistCurrentTabStateRef.current = persistCurrentTabState;
  }, [persistCurrentTabState]);

  useEffect(() => {
    onDesktopCloseRequestedRef.current = onDesktopCloseRequested;
  }, [onDesktopCloseRequested]);

  const captureSessionState = useCallback(() => {
    if (!hasActiveTabRef.current) {
      return;
    }

    const now = Date.now();
    if (now - lastCapturedAtRef.current < CAPTURE_DEDUP_WINDOW_MS) {
      return;
    }

    lastCapturedAtRef.current = now;
    persistCurrentTabStateRef.current();
  }, []);

  useEventListener(browserWindow, "pagehide", captureSessionState);
  useEventListener(browserWindow, "beforeunload", captureSessionState);
  useEventListener(browserDocument, "visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      captureSessionState();
    }
  });

  useEffect(() => {
    if (!enabled || !isDesktop) {
      return;
    }

    let cancelled = false;
    let unlisten: null | (() => void) = null;

    void (async () => {
      unlisten = await listenForPlatformCloseRequested((event) => {
        captureSessionState();
        onDesktopCloseRequestedRef.current?.(event);
      });

      if (cancelled) {
        try {
          unlisten?.();
        } catch {
          // ignore
        }
        unlisten = null;
      }
    })();

    return () => {
      cancelled = true;
      try {
        unlisten?.();
      } catch {
        // ignore
      }
    };
  }, [captureSessionState, enabled, isDesktop]);
};
