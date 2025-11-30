import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export const cn = (...classLists: ClassValue[]) =>
  twMerge(clsx(classLists));

export const setGlobalCursor = (cursor: string) => {
  const styleId = 'global-cursor-style';
  let styleEl = document.getElementById(styleId) as HTMLStyleElement;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  styleEl.innerHTML = `* { cursor: ${cursor} !important; }`;
  document.body.style.cursor = cursor;
};

export const resetGlobalCursor = () => {
  const styleEl = document.getElementById('global-cursor-style');
  if (styleEl) {
    styleEl.remove();
  }
  document.body.style.cursor = '';
};
