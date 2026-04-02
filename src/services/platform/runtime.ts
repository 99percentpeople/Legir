import { isTauri } from "@tauri-apps/api/core";

export const isDesktopApp = () => isTauri();

export const isWebApp = () => !isDesktopApp();

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
