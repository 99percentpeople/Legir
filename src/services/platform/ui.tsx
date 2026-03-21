import React from "react";

import { isDesktopApp, isWebApp } from "./runtime";
import { getPlatformDocumentSaveMode } from "./viewState";

export type PlatformUiState = {
  isDesktop: boolean;
  isWeb: boolean;
  documentSaveMode: "file" | "draft";
  supportsRecentFiles: boolean;
  shouldLoadFontFaces: boolean;
};

const readPlatformUiState = (): PlatformUiState => {
  const isDesktop = isDesktopApp();
  return {
    isDesktop,
    isWeb: !isDesktop,
    documentSaveMode: getPlatformDocumentSaveMode(),
    supportsRecentFiles: isDesktop,
    shouldLoadFontFaces: isWebApp(),
  };
};

export const getPlatformUiState = () => {
  return readPlatformUiState();
};

export const usePlatformUi = () => {
  return React.useMemo(readPlatformUiState, []);
};

export const shouldLoadPlatformFontFaces = () => {
  return readPlatformUiState().shouldLoadFontFaces;
};

export const confirmPlatformAction = async (message: string) => {
  if (isDesktopApp()) {
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    return await confirm(message);
  }

  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    return window.confirm(message);
  }

  return false;
};

type PlatformSwitchProps = {
  desktop?: React.ReactNode;
  web?: React.ReactNode;
};

export const PlatformSwitch: React.FC<PlatformSwitchProps> = ({
  desktop = null,
  web = null,
}) => {
  return <>{isDesktopApp() ? desktop : web}</>;
};

type PlatformTextProps = {
  desktop: React.ReactNode;
  web: React.ReactNode;
};

export const PlatformText: React.FC<PlatformTextProps> = ({ desktop, web }) => {
  return <>{isDesktopApp() ? desktop : web}</>;
};
