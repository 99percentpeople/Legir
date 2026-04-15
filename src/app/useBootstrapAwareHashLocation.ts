import { useEffect, useState } from "react";
import { useHashLocation } from "wouter/use-hash-location";
import type { BaseLocationHook, Path } from "wouter";

import {
  clearPwaLaunchRouteHint,
  EDITOR_WINDOW_BOOTSTRAP_ROUTE,
  hasPendingPwaLaunchFiles,
  hasPendingEditorWindowBootstrap,
  hasPwaLaunchRouteHint,
  listenForPwaLaunchFiles,
  PWA_LAUNCH_ROUTE_WAIT_MS,
} from "@/services/platform";

type BootstrapAwareHashLocationHook = BaseLocationHook & {
  hrefs?: (href: Path) => string;
};

export const useBootstrapAwareHashLocation: BootstrapAwareHashLocationHook =
  () => {
    const [location, navigate] = useHashLocation();
    const [hasPendingEditorEntry, setHasPendingEditorEntry] = useState(() => {
      return (
        hasPendingEditorWindowBootstrap() ||
        hasPendingPwaLaunchFiles() ||
        hasPwaLaunchRouteHint()
      );
    });

    useEffect(() => {
      setHasPendingEditorEntry(
        hasPendingEditorWindowBootstrap() ||
          hasPendingPwaLaunchFiles() ||
          hasPwaLaunchRouteHint(),
      );

      let cancelled = false;
      let unlisten: null | (() => void) = null;
      let launchHintTimeoutId: number | null = null;

      if (hasPwaLaunchRouteHint() && !hasPendingPwaLaunchFiles()) {
        launchHintTimeoutId = window.setTimeout(() => {
          if (cancelled) {
            return;
          }

          clearPwaLaunchRouteHint();
          setHasPendingEditorEntry(
            hasPendingEditorWindowBootstrap() || hasPendingPwaLaunchFiles(),
          );
        }, PWA_LAUNCH_ROUTE_WAIT_MS);
      }

      void (async () => {
        unlisten = await listenForPwaLaunchFiles((handles) => {
          if (cancelled || handles.length === 0) {
            return;
          }

          if (launchHintTimeoutId !== null) {
            window.clearTimeout(launchHintTimeoutId);
            launchHintTimeoutId = null;
          }

          setHasPendingEditorEntry(true);
        });

        if (cancelled) {
          try {
            unlisten?.();
          } catch {
            // ignore
          }
        }
      })();

      return () => {
        cancelled = true;
        if (launchHintTimeoutId !== null) {
          window.clearTimeout(launchHintTimeoutId);
        }
        try {
          unlisten?.();
        } catch {
          // ignore
        }
      };
    }, []);

    if (location === "/" && hasPendingEditorEntry) {
      return [EDITOR_WINDOW_BOOTSTRAP_ROUTE, navigate];
    }

    return [location, navigate];
  };

useBootstrapAwareHashLocation.hrefs = (href) => `#${href}`;
