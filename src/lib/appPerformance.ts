const marked = new Set<string>();

export const markAppPerformance = (
  name: string,
  options?: { once?: boolean },
) => {
  if (
    typeof performance === "undefined" ||
    typeof performance.mark !== "function"
  ) {
    return;
  }
  if (options?.once && marked.has(name)) return;
  marked.add(name);
  performance.mark(name);
};

export const measureAppPerformance = (
  name: string,
  startMark: string,
  endMark: string,
) => {
  if (
    typeof performance === "undefined" ||
    typeof performance.measure !== "function" ||
    performance.getEntriesByName(startMark, "mark").length === 0 ||
    performance.getEntriesByName(endMark, "mark").length === 0
  ) {
    return;
  }

  performance.measure(name, startMark, endMark);
};
