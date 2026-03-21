import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import { isDesktopApp } from "./runtime";

const getDroppedFilePath = (event: unknown) => {
  const payload =
    typeof event === "object" && event !== null && "payload" in event
      ? (event as { payload?: unknown }).payload
      : null;

  if (!payload || typeof payload !== "object") return null;
  if (!("type" in payload) || (payload as { type?: unknown }).type !== "drop") {
    return null;
  }

  const rawPaths = (payload as { paths?: unknown }).paths;
  const paths = Array.isArray(rawPaths)
    ? rawPaths.filter((path): path is string => typeof path === "string")
    : [];

  return paths.find((path) => typeof path === "string") || null;
};

export const getPlatformUserName = async () => {
  if (!isDesktopApp()) return null;

  const name = await invoke<string | null>("get_system_username");
  return typeof name === "string" && name.trim().length > 0
    ? name.trim()
    : null;
};

export const listenForPlatformFileDrop = async (
  listener: (filePath: string) => void,
) => {
  if (!isDesktopApp()) {
    return () => {};
  }

  const webview = getCurrentWebview();
  return await webview.onDragDropEvent((event: unknown) => {
    const filePath = getDroppedFilePath(event);
    if (!filePath) return;
    listener(filePath);
  });
};
