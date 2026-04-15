type PwaLaunchFilesListener = (handles: FileSystemFileHandle[]) => void;

const PWA_FILE_LAUNCH_QUERY_KEY = "launch";
const PWA_FILE_LAUNCH_QUERY_VALUE = "file";
export const PWA_LAUNCH_ROUTE_WAIT_MS = 400;

let hasInitializedLaunchQueue = false;
let pendingLaunchHandles: FileSystemFileHandle[] = [];

const launchFilesListeners = new Set<PwaLaunchFilesListener>();

const isFileHandle = (value: unknown): value is FileSystemFileHandle => {
  return (
    !!value &&
    typeof value === "object" &&
    "kind" in value &&
    value.kind === "file" &&
    "getFile" in value &&
    typeof value.getFile === "function"
  );
};

const normalizeLaunchFiles = (value: unknown) => {
  if (!value || typeof value !== "object" || !("files" in value)) {
    return [];
  }

  const files = (value as { files?: unknown }).files;
  if (!Array.isArray(files)) {
    return [];
  }

  return files.filter(isFileHandle);
};

const ensureLaunchEditorRoute = () => {
  if (typeof window === "undefined") {
    return;
  }

  const currentHash = window.location.hash.trim();
  if (currentHash === "#/editor" || currentHash.startsWith("#/editor?")) {
    return;
  }

  if (!currentHash || currentHash === "#" || currentHash === "#/") {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}#/editor`,
    );
  }
};

export const hasPwaLaunchRouteHint = () => {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    new URL(window.location.href).searchParams.get(
      PWA_FILE_LAUNCH_QUERY_KEY,
    ) === PWA_FILE_LAUNCH_QUERY_VALUE
  );
};

export const clearPwaLaunchRouteHint = () => {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  if (
    url.searchParams.get(PWA_FILE_LAUNCH_QUERY_KEY) !==
    PWA_FILE_LAUNCH_QUERY_VALUE
  ) {
    return;
  }

  url.searchParams.delete(PWA_FILE_LAUNCH_QUERY_KEY);
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
};

const dispatchLaunchFiles = (handles: FileSystemFileHandle[]) => {
  if (handles.length === 0) {
    return;
  }

  ensureLaunchEditorRoute();
  clearPwaLaunchRouteHint();

  if (launchFilesListeners.size === 0) {
    pendingLaunchHandles = [...pendingLaunchHandles, ...handles];
    return;
  }

  for (const listener of launchFilesListeners) {
    listener(handles);
  }
};

export const initializePwaLaunchQueue = () => {
  if (hasInitializedLaunchQueue || typeof window === "undefined") {
    return;
  }

  hasInitializedLaunchQueue = true;

  if (typeof window.launchQueue?.setConsumer !== "function") {
    return;
  }

  window.launchQueue.setConsumer((launchParams) => {
    dispatchLaunchFiles(normalizeLaunchFiles(launchParams));
  });
};

export const hasPendingPwaLaunchFiles = () => {
  return pendingLaunchHandles.length > 0;
};

export const consumePendingPwaLaunchFiles = () => {
  const nextHandles = [...pendingLaunchHandles];
  pendingLaunchHandles = [];
  return nextHandles;
};

export const listenForPwaLaunchFiles = async (
  listener: PwaLaunchFilesListener,
) => {
  launchFilesListeners.add(listener);

  return () => {
    launchFilesListeners.delete(listener);
  };
};
