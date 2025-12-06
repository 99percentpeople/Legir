import { useEffect, useRef } from "react";

/**
 * A hook to monitor the rendering performance of a component.
 * It logs the time taken for the component to mount and update.
 *
 * @param componentName The name of the component to monitor
 * @param enabled Whether monitoring is enabled (default: false, or true in development)
 */
export const usePerformanceMonitor = (
  componentName: string,
  enabled: boolean = process.env.NODE_ENV === "development",
) => {
  const renderCount = useRef(0);
  const startTime = useRef(performance.now());

  useEffect(() => {
    if (!enabled) return;

    const endTime = performance.now();
    const duration = endTime - startTime.current;

    renderCount.current += 1;

    console.log(
      `%c[Perf] ${componentName}`,
      "color: #f59e0b; font-weight: bold;",
      `Render #${renderCount.current} took ${duration.toFixed(2)}ms`,
    );

    // Reset start time for next render (updates)
    startTime.current = performance.now();
  });

  // Capture time at the start of render phase
  startTime.current = performance.now();
};
