/// <reference types="vite/client" />
/// <reference types="wicg-file-system-access" />

import "react";

declare const process: {
  env: {
    APP_NAME?: string;
  };
};

declare global {
  interface LaunchParams {
    files: FileSystemFileHandle[];
  }

  interface LaunchQueue {
    setConsumer: (consumer: (launchParams: LaunchParams) => void) => void;
  }

  interface Window {
    launchQueue?: LaunchQueue;
  }
}

declare module "react" {
  interface CSSProperties {
    [key: `--${string}`]: string | number;
  }
}
