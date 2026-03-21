import {
  type CloseRequestedEvent,
  getCurrentWindow,
} from "@tauri-apps/api/window";

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
  if (!isDesktopApp()) return;
  const win = getCurrentWindow();
  await win.close();
};
