/// <reference types="vite/client" />
/// <reference types="wicg-file-system-access" />

import "react";

declare const process: {
  env: {
    API_KEY?: string;
    GEMINI_API_KEY?: string;
    OPENAI_API_KEY?: string;
    OPENAI_API_URL?: string;
    GOOGLE_TRANSLATE_API_KEY?: string;
    APP_NAME?: string;
  };
};

declare module "react" {
  interface CSSProperties {
    [key: `--${string}`]: string | number;
  }
}
