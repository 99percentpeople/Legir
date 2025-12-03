import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...classLists: ClassValue[]) => twMerge(clsx(classLists));

const activeCursors = new Map<string, string>();

const updateGlobalCursorStyle = () => {
  const styleId = "global-cursor-style";
  let styleEl = document.getElementById(styleId) as HTMLStyleElement;

  if (activeCursors.size === 0) {
    if (styleEl) styleEl.remove();
    return;
  }

  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }

  // Use the last added cursor (LIFO-ish behavior based on insertion order)
  const cursor = Array.from(activeCursors.values()).pop();
  styleEl.innerHTML = `* { cursor: ${cursor} !important; }`;
};

export const setGlobalCursor = (cursor: string, source: string = "global") => {
  activeCursors.set(source, cursor);
  updateGlobalCursorStyle();
};

export const resetGlobalCursor = (source: string = "global") => {
  activeCursors.delete(source);
  updateGlobalCursorStyle();
};
