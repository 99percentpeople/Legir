const EDITOR_WINDOW_BOOTSTRAP_QUERY_KEY = "appWindowBootstrap";
export const EDITOR_WINDOW_BOOTSTRAP_ROUTE = "/editor";

export type EditorWindowBootstrap =
  | {
      kind: "startup-open";
      filePath: string;
    }
  | {
      kind: "startup-open-web";
      recentFilePath: string;
    }
  | {
      kind: "tab-transfer";
      transferId: string;
    };

declare global {
  interface Window {
    __APP_WINDOW_BOOTSTRAP__?: unknown;
  }
}

let cachedInjectedWindowBootstrap: EditorWindowBootstrap | null | undefined;
let pendingWindowBootstrapRouteOverride: boolean | undefined;
let pendingWindowBootstrapCompletion: Promise<void> | null = null;
let resolvePendingWindowBootstrapCompletion: (() => void) | null = null;
let pendingWindowBootstrapFinalized = false;

const normalizeNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseEditorWindowBootstrap = (
  value: unknown,
): EditorWindowBootstrap | null => {
  if (!value || typeof value !== "object") return null;

  const rawBootstrap = value as Record<string, unknown>;
  if (rawBootstrap.kind === "startup-open") {
    const filePath = normalizeNonEmptyString(rawBootstrap.filePath);
    return filePath
      ? {
          kind: "startup-open",
          filePath,
        }
      : null;
  }

  if (rawBootstrap.kind === "startup-open-web") {
    const recentFilePath = normalizeNonEmptyString(rawBootstrap.recentFilePath);
    return recentFilePath
      ? {
          kind: "startup-open-web",
          recentFilePath,
        }
      : null;
  }

  if (rawBootstrap.kind === "tab-transfer") {
    const transferId = normalizeNonEmptyString(rawBootstrap.transferId);
    return transferId
      ? {
          kind: "tab-transfer",
          transferId,
        }
      : null;
  }

  return null;
};

const readInjectedWindowBootstrap = () => {
  if (cachedInjectedWindowBootstrap !== undefined) {
    return cachedInjectedWindowBootstrap;
  }

  if (typeof window === "undefined") {
    cachedInjectedWindowBootstrap = null;
    return cachedInjectedWindowBootstrap;
  }

  cachedInjectedWindowBootstrap = parseEditorWindowBootstrap(
    window.__APP_WINDOW_BOOTSTRAP__,
  );
  return cachedInjectedWindowBootstrap;
};

const resolvePendingEditorWindowBootstrap = () => {
  if (pendingWindowBootstrapFinalized) {
    return null;
  }

  if (cachedInjectedWindowBootstrap !== undefined) {
    return cachedInjectedWindowBootstrap;
  }

  if (typeof window === "undefined") {
    cachedInjectedWindowBootstrap = null;
    return cachedInjectedWindowBootstrap;
  }

  const url = new URL(window.location.href);
  const rawBootstrap = url.searchParams.get(EDITOR_WINDOW_BOOTSTRAP_QUERY_KEY);
  if (rawBootstrap !== null) {
    url.searchParams.delete(EDITOR_WINDOW_BOOTSTRAP_QUERY_KEY);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );

    try {
      cachedInjectedWindowBootstrap = parseEditorWindowBootstrap(
        JSON.parse(rawBootstrap),
      );
    } catch {
      cachedInjectedWindowBootstrap = null;
    }

    return cachedInjectedWindowBootstrap;
  }

  return readInjectedWindowBootstrap();
};

const hasQueryWindowBootstrap = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const url = new URL(window.location.href);
  return url.searchParams.has(EDITOR_WINDOW_BOOTSTRAP_QUERY_KEY);
};

const hasInitialPendingEditorWindowBootstrap = () => {
  if (pendingWindowBootstrapRouteOverride !== undefined) {
    return pendingWindowBootstrapRouteOverride;
  }

  pendingWindowBootstrapRouteOverride =
    hasQueryWindowBootstrap() || !!readInjectedWindowBootstrap();
  return pendingWindowBootstrapRouteOverride;
};

export const buildEditorWindowBootstrapRoute = (
  bootstrap: EditorWindowBootstrap,
) => {
  const search = new URLSearchParams({
    [EDITOR_WINDOW_BOOTSTRAP_QUERY_KEY]: JSON.stringify(bootstrap),
  });
  return `/?${search.toString()}#${EDITOR_WINDOW_BOOTSTRAP_ROUTE}`;
};

export const hasPendingEditorWindowBootstrap = () => {
  if (pendingWindowBootstrapCompletion) return true;
  return hasInitialPendingEditorWindowBootstrap();
};

export const acquirePendingEditorWindowBootstrap = (): {
  bootstrap: EditorWindowBootstrap | null;
  completion: Promise<void>;
} => {
  const bootstrap = resolvePendingEditorWindowBootstrap();
  if (!bootstrap) {
    return {
      bootstrap: null,
      completion: pendingWindowBootstrapCompletion ?? Promise.resolve(),
    };
  }

  if (!pendingWindowBootstrapCompletion) {
    pendingWindowBootstrapCompletion = new Promise<void>((resolve) => {
      resolvePendingWindowBootstrapCompletion = resolve;
    });
    return {
      bootstrap,
      completion: pendingWindowBootstrapCompletion,
    };
  }

  return {
    bootstrap: null,
    completion: pendingWindowBootstrapCompletion,
  };
};

export const finishPendingEditorWindowBootstrap = () => {
  pendingWindowBootstrapFinalized = true;
  pendingWindowBootstrapRouteOverride = false;
  cachedInjectedWindowBootstrap = null;
  resolvePendingWindowBootstrapCompletion?.();
  resolvePendingWindowBootstrapCompletion = null;
  pendingWindowBootstrapCompletion = null;
};
