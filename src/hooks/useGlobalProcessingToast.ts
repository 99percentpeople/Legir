import React from "react";
import { toast } from "sonner";

export const useGlobalProcessingToast = (options: {
  isProcessing: boolean;
  processingStatus: string | null;
  defaultMessage: string;
  toastId?: string;
  debounceMs?: number;
}) => {
  const {
    isProcessing,
    processingStatus,
    defaultMessage,
    toastId = "global-processing",
    debounceMs = 100,
  } = options;

  const processingToastTimerRef = React.useRef<number | null>(null);
  const processingToastShownRef = React.useRef(false);
  const latestRef = React.useRef({
    isProcessing,
    processingStatus,
    defaultMessage,
  });

  React.useLayoutEffect(() => {
    latestRef.current = { isProcessing, processingStatus, defaultMessage };
  }, [isProcessing, processingStatus, defaultMessage]);

  React.useLayoutEffect(() => {
    if (!isProcessing) {
      if (processingToastTimerRef.current !== null) {
        window.clearTimeout(processingToastTimerRef.current);
        processingToastTimerRef.current = null;
      }

      processingToastShownRef.current = false;
      toast.dismiss(toastId);
      return;
    }

    const msg = processingStatus || defaultMessage;

    if (processingToastShownRef.current) {
      toast.loading(msg, { id: toastId, duration: Infinity });
      return;
    }

    if (processingToastTimerRef.current !== null) return;
    processingToastTimerRef.current = window.setTimeout(() => {
      processingToastTimerRef.current = null;

      const snapshot = latestRef.current;
      if (!snapshot.isProcessing) return;

      processingToastShownRef.current = true;
      toast.loading(snapshot.processingStatus || snapshot.defaultMessage, {
        id: toastId,
        duration: Infinity,
      });
    }, debounceMs);
  }, [isProcessing, processingStatus, defaultMessage, toastId, debounceMs]);

  React.useEffect(() => {
    return () => {
      if (processingToastTimerRef.current !== null) {
        window.clearTimeout(processingToastTimerRef.current);
        processingToastTimerRef.current = null;
      }
    };
  }, []);
};
