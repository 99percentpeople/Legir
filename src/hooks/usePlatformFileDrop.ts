import { useCallback, useEffect, useRef, useState } from "react";

import { useEventListeners } from "@/hooks/useEventListener";
import {
  hasPlatformFileTransfer,
  isPlatformFileDropInsideScope,
  readPlatformDroppedPdfs,
  setPlatformFileDropEffect,
  type PlatformDroppedPdf,
  type PlatformFileDropScopeOptions,
} from "@/services/platform";

interface UsePlatformFileDropOptions {
  enabled?: boolean;
  getTargetElement?: () => HTMLElement | null;
  onDrop: (payloads: PlatformDroppedPdf[]) => void | Promise<void>;
}

export const usePlatformFileDrop = ({
  enabled = true,
  getTargetElement,
  onDrop,
}: UsePlatformFileDropOptions) => {
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const isActiveRef = useRef(false);
  const getTargetElementRef = useRef(getTargetElement);
  const onDropRef = useRef(onDrop);

  useEffect(() => {
    getTargetElementRef.current = getTargetElement;
  }, [getTargetElement]);

  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  const getScopeOptions = useCallback(():
    | PlatformFileDropScopeOptions
    | undefined => {
    const getCurrentTargetElement = getTargetElementRef.current;
    return getCurrentTargetElement
      ? { getTargetElement: getCurrentTargetElement }
      : undefined;
  }, []);

  const isInsideScope = useCallback(
    (event: DragEvent) =>
      isPlatformFileDropInsideScope(event, getScopeOptions()),
    [getScopeOptions],
  );

  const setActive = useCallback((nextActive: boolean) => {
    if (isActiveRef.current === nextActive) return;
    isActiveRef.current = nextActive;
    setIsFileDragActive(nextActive);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setActive(false);
    }
  }, [enabled, setActive]);

  useEffect(() => {
    return () => {
      isActiveRef.current = false;
    };
  }, []);

  const handleDragEnter = useCallback(
    (event: DragEvent) => {
      if (!hasPlatformFileTransfer(event)) return;
      if (!isInsideScope(event)) return;

      event.preventDefault();
      setActive(true);
    },
    [isInsideScope, setActive],
  );

  const handleDragOver = useCallback(
    (event: DragEvent) => {
      if (!hasPlatformFileTransfer(event)) return;

      if (!isInsideScope(event)) {
        setActive(false);
        return;
      }

      event.preventDefault();
      setPlatformFileDropEffect(event);
      setActive(true);
    },
    [isInsideScope, setActive],
  );

  const handleDragLeave = useCallback(
    (event: DragEvent) => {
      if (!hasPlatformFileTransfer(event)) return;

      if (
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight
      ) {
        setActive(false);
      }
    },
    [setActive],
  );

  const handleDrop = useCallback(
    (event: DragEvent) => {
      if (!hasPlatformFileTransfer(event)) return;

      event.preventDefault();
      setActive(false);

      if (!isInsideScope(event)) return;

      void readPlatformDroppedPdfs(event)
        .then((payloads) => {
          if (payloads.length > 0) {
            return onDropRef.current(payloads);
          }
        })
        .catch((error) => {
          console.error("Failed to read dropped PDF", error);
        });
    },
    [isInsideScope, setActive],
  );

  const target = enabled && typeof window !== "undefined" ? window : null;

  useEventListeners(target, {
    dragenter: (event) => handleDragEnter(event as DragEvent),
    dragover: (event) => handleDragOver(event as DragEvent),
    dragleave: (event) => handleDragLeave(event as DragEvent),
    drop: (event) => handleDrop(event as DragEvent),
  });

  return isFileDragActive;
};
