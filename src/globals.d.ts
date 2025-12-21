/// <reference types="vite/client" />
/// <reference types="wicg-file-system-access" />

import "react";

declare module "react" {
  interface CSSProperties {
    [key: `--${string}`]: string | number;
  }
}
