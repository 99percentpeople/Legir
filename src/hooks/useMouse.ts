import { useState, useCallback, useRef } from "react";
import { useEventListener } from "@/hooks/useEventListener";

interface MousePosition {
  x: number;
  y: number;
}

interface UseMouseOptions {
  resetOnExit?: boolean;
}

export function useMouse<T extends Element = HTMLElement>(
  options: UseMouseOptions = {},
) {
  const { resetOnExit = false } = options;
  const [position, setPosition] = useState<MousePosition>({ x: 0, y: 0 });
  const [element, setElement] = useState<T | null>(null);
  const sizeRef = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Callback ref to capture the element (if provided)
  const ref = useCallback((node: T | null) => {
    setElement(node);
  }, []);

  // Handle mouse movement using native MouseEvent
  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (element) {
        const rect = element.getBoundingClientRect();
        sizeRef.current = { width: rect.width, height: rect.height };
        // Calculate coordinates relative to the element
        const x = Math.max(0, Math.round(event.clientX - rect.left));
        const y = Math.max(0, Math.round(event.clientY - rect.top));
        setPosition({ x, y });
      } else {
        // Fallback: use client coordinates when no element is provided
        sizeRef.current = { width: 0, height: 0 };
        setPosition({ x: event.clientX, y: event.clientY });
      }
    },
    [element],
  );

  // Optionally reset mouse position on leaving the element
  const handleMouseLeave = useCallback(() => {
    setPosition({ x: 0, y: 0 });
    sizeRef.current = { width: 0, height: 0 };
  }, []);

  const target: T | Document | null =
    typeof document !== "undefined" ? element || document : null;

  useEventListener<MouseEvent>(target, "mousemove", handleMouseMove);

  useEventListener(resetOnExit ? target : null, "mouseleave", () =>
    handleMouseLeave(),
  );

  return {
    ref,
    ...position,
    width: sizeRef.current.width,
    height: sizeRef.current.height,
  };
}
