type PwaLaunchFilesListener = (handles: FileSystemFileHandle[]) => void;
type PwaLaunchProcessingListener = (isProcessing: boolean) => void;

let hasInitializedLaunchQueue = false;
let pendingLaunchHandles: FileSystemFileHandle[] = [];
let activePwaLaunchProcessingCount = 0;
const primedLaunchFiles = new WeakMap<
  FileSystemFileHandle,
  Promise<{ file: File; bytes: Uint8Array }>
>();

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

  for (const handle of handles) {
    if (!primedLaunchFiles.has(handle)) {
      const pending = handle.getFile().then(async (file) => ({
        file,
        bytes: new Uint8Array(await file.arrayBuffer()),
      }));
      // The launch listener may not be mounted yet. Keep the original promise
      // rejectable for its eventual consumer while avoiding a transient
      // unhandled-rejection report during bootstrap.
      void pending.catch(() => undefined);
      primedLaunchFiles.set(handle, pending);
    }
  }

  if (launchFilesListeners.size === 0) {
    pendingLaunchHandles = [...pendingLaunchHandles, ...handles];
    return;
  }

  for (const listener of launchFilesListeners) {
    listener(handles);
  }
};

export const readPwaLaunchFile = async (handle: FileSystemFileHandle) => {
  const primed = primedLaunchFiles.get(handle);
  if (primed) {
    primedLaunchFiles.delete(handle);
    return await primed;
  }
  const file = await handle.getFile();
  return {
    file,
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
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
