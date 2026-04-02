import { useHashLocation } from "wouter/use-hash-location";
import type { BaseLocationHook, Path } from "wouter";

import {
  EDITOR_WINDOW_BOOTSTRAP_ROUTE,
  hasPendingEditorWindowBootstrap,
} from "@/services/platform";

type BootstrapAwareHashLocationHook = BaseLocationHook & {
  hrefs?: (href: Path) => string;
};

export const useBootstrapAwareHashLocation: BootstrapAwareHashLocationHook =
  () => {
    const [location, navigate] = useHashLocation();

    if (location === "/" && hasPendingEditorWindowBootstrap()) {
      return [EDITOR_WINDOW_BOOTSTRAP_ROUTE, navigate];
    }

    return [location, navigate];
  };

useBootstrapAwareHashLocation.hrefs = (href) => `#${href}`;
