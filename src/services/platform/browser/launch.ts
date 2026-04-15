type PwaLaunchFilesListener = (handles: FileSystemFileHandle[]) => void;
type PwaLaunchProcessingListener = (isProcessing: boolean) => void;

let hasInitializedLaunchQueue = false;
let pendingLaunchHandles: FileSystemFileHandle[] = [];
let activePwaLaunchProcessingCount = 0;

const launchFilesListeners = new Set<PwaLaunchFilesListener>();
const launchProcessingListeners = new Set<PwaLaunchProcessingListener>();

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

const dispatchLaunchFiles = (handles: FileSystemFileHandle[]) => {
  if (handles.length === 0) {
    return;
  }

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

const notifyPwaLaunchProcessingListeners = () => {
  const isProcessing = activePwaLaunchProcessingCount > 0;
  for (const listener of launchProcessingListeners) {
    listener(isProcessing);
  }
};

export const hasActivePwaLaunchProcessing = () => {
  return activePwaLaunchProcessingCount > 0;
};

export const beginPwaLaunchProcessing = () => {
  activePwaLaunchProcessingCount += 1;
  notifyPwaLaunchProcessingListeners();
};

export const finishPwaLaunchProcessing = () => {
  activePwaLaunchProcessingCount = Math.max(
    0,
    activePwaLaunchProcessingCount - 1,
  );
  notifyPwaLaunchProcessingListeners();
};

export const listenForPwaLaunchFiles = async (
  listener: PwaLaunchFilesListener,
) => {
  launchFilesListeners.add(listener);

  return () => {
    launchFilesListeners.delete(listener);
  };
};

export const listenForPwaLaunchProcessing = (
  listener: PwaLaunchProcessingListener,
) => {
  launchProcessingListeners.add(listener);

  return () => {
    launchProcessingListeners.delete(listener);
  };
};
