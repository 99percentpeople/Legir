import { useBrowserLocation } from "wouter/use-browser-location";
import type { BaseLocationHook, Path } from "wouter";

import {
  EDITOR_WINDOW_BOOTSTRAP_ROUTE,
  hasPendingEditorWindowBootstrap,
} from "@/services/platform";

type BootstrapAwareBrowserLocationHook = BaseLocationHook & {
  hrefs?: (href: Path) => string;
};

export const useBootstrapAwareBrowserLocation: BootstrapAwareBrowserLocationHook =
  () => {
    const [location, navigate] = useBrowserLocation();
    const hasPendingWindowBootstrap = hasPendingEditorWindowBootstrap();

    if (location === "/" && hasPendingWindowBootstrap) {
      return [EDITOR_WINDOW_BOOTSTRAP_ROUTE, navigate];
    }

    return [location, navigate];
  };

useBootstrapAwareBrowserLocation.hrefs = (href) => href;
