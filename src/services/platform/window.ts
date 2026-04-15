import {
  type CloseRequestedEvent,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import {
  getPlatformManagedWindowId,
  syncPlatformCurrentWindowState,
  unregisterPlatformCurrentWindow,
} from "./multiWindow/host";
import { isDesktopApp } from "./runtime";

export type PlatformCloseRequestEvent = {
  preventDefault: () => void;
};

export const setPlatformFullscreen = async (next: boolean) => {
  if (isDesktopApp()) {
    const win = getCurrentWindow();
    await win.setFullscreen(next);
    return;
  }

  if (typeof document === "undefined") return;

  if (next) {
    await document.documentElement.requestFullscreen();
    return;
  }

  if (document.fullscreenElement) {
    await document.exitFullscreen();
  }
};

export const getPlatformWindowId = () => {
  if (isDesktopApp()) {
    try {
      return getCurrentWebview().label;
    } catch {
      try {
        return getCurrentWindow().label;
      } catch {
        return "main";
      }
    }
  }

  // Keep a stable browser-side window id even before the page enters
  // installed-PWA mode so host transitions do not require a reload.
  return getPlatformManagedWindowId();
};

export const exitPlatformFullscreen = async () => {
  await setPlatformFullscreen(false);
};

export const subscribePlatformFullscreenChange = (
  listener: (isFullscreen: boolean) => void,
) => {
  if (isDesktopApp() || typeof document === "undefined") {
    return () => {};
  }

  const handleChange = () => {
    listener(!!document.fullscreenElement);
  };

  document.addEventListener("fullscreenchange", handleChange);
  return () => {
    document.removeEventListener("fullscreenchange", handleChange);
  };
};

export const setPlatformWindowTitle = async (title: string) => {
  if (isDesktopApp()) {
    const win = getCurrentWindow();
    await win.setTitle(title);
    return;
  }

  if (typeof document !== "undefined") {
    document.title = title;
    void syncPlatformCurrentWindowState({
      title,
    });
  }
};

export const listenForPlatformCloseRequested = async (
  listener: (event: PlatformCloseRequestEvent) => void,
) => {
  if (!isDesktopApp()) {
    return () => {};
  }

  const win = getCurrentWindow();
  return await win.onCloseRequested((event: CloseRequestedEvent) => {
    listener({
      preventDefault: () => {
        try {
          event.preventDefault();
        } catch {
          // ignore
        }
      },
    });
  });
};

export const closePlatformWindow = async () => {
  if (isDesktopApp()) {
    const win = getCurrentWindow();
    await win.close();
    return;
  }

  if (typeof window !== "undefined") {
    await unregisterPlatformCurrentWindow({
      awaitReply: true,
    }).catch(() => false);
    window.close();
  }
};

export const destroyPlatformWindow = async () => {
  if (isDesktopApp()) {
    const win = getCurrentWindow();
    await win.destroy();
    return;
  }

  if (typeof window !== "undefined") {
    await unregisterPlatformCurrentWindow({
      awaitReply: true,
    }).catch(() => false);
    window.close();
  }
};
