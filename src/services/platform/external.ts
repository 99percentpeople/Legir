import { openUrl } from "@tauri-apps/plugin-opener";

import { isDesktopApp } from "./runtime";

export const openExternalUrl = async (url: string) => {
  if (isDesktopApp()) {
    await openUrl(url);
    return;
  }

  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
};
