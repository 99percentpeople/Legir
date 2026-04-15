import { isTauri } from "@tauri-apps/api/core";

export const isDesktopApp = () => isTauri();

export const isWebApp = () => !isDesktopApp();

export type PlatformHostKind = "tauri" | "installed-pwa" | "browser-web";
export type PlatformRuntimeSnapshot = {
  hostKind: PlatformHostKind;
  isDesktop: boolean;
  isInstalledPwa: boolean;
  supportsMultiWindow: boolean;
};

export const isInstalledPwa = () => {
  if (isDesktopApp() || typeof window === "undefined") {
    return false;
  }

  if (window.matchMedia?.("(display-mode: standalone)").matches) {
    return true;
  }

  const standaloneNavigator = navigator as Navigator & {
    standalone?: boolean;
  };

  return standaloneNavigator.standalone === true;
};

export const getPlatformHostKind = (): PlatformHostKind => {
  if (isDesktopApp()) {
    return "tauri";
  }

  return isInstalledPwa() ? "installed-pwa" : "browser-web";
};

export const supportsPlatformMultiWindow = () => {
  if (isDesktopApp()) {
    return true;
  }

  if (!isInstalledPwa() || typeof window === "undefined") {
    return false;
  }

  return (
    typeof window.open === "function" &&
    typeof BroadcastChannel !== "undefined" &&
    typeof indexedDB !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator
  );
};

export const readPlatformRuntimeSnapshot = (): PlatformRuntimeSnapshot => {
  const desktop = isDesktopApp();
  const installedPwa = isInstalledPwa();

  return {
    hostKind: desktop
      ? "tauri"
      : installedPwa
        ? "installed-pwa"
        : "browser-web",
    isDesktop: desktop,
    isInstalledPwa: installedPwa,
    supportsMultiWindow: supportsPlatformMultiWindow(),
  };
};

export const subscribePlatformRuntimeChange = (
  listener: (snapshot: PlatformRuntimeSnapshot) => void,
) => {
  if (typeof window === "undefined") {
    return () => {};
  }

  const standaloneMediaQuery = window.matchMedia?.(
    "(display-mode: standalone)",
  );
  const handleChange = () => {
    listener(readPlatformRuntimeSnapshot());
  };

  standaloneMediaQuery?.addEventListener?.("change", handleChange);
  window.addEventListener("appinstalled", handleChange);
  window.addEventListener("pageshow", handleChange);
  document.addEventListener("visibilitychange", handleChange);

  return () => {
    standaloneMediaQuery?.removeEventListener?.("change", handleChange);
    window.removeEventListener("appinstalled", handleChange);
    window.removeEventListener("pageshow", handleChange);
    document.removeEventListener("visibilitychange", handleChange);
  };
};

export const isWindowsPlatform = () => {
  if (typeof navigator === "undefined") return false;

  const userAgentData = (
    navigator as Navigator & {
      userAgentData?: {
        platform?: string;
      };
    }
  ).userAgentData;

  const platformHint = [
    userAgentData?.platform,
    navigator.platform,
    navigator.userAgent,
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();

  return platformHint.includes("win");
};
