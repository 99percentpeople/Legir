import type { Annotation } from "@/types";

const nonNegative = (value: number | undefined, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback;

export const getFreeTextPadding = (
  annotation: Pick<Annotation, "textPadding" | "borderWidth">,
) => {
  const fallback = nonNegative(annotation.borderWidth);
  const value = annotation.textPadding;
  if (typeof value === "object" && value !== null) {
    return {
      top: nonNegative(value.top, fallback),
      right: nonNegative(value.right, fallback),
      bottom: nonNegative(value.bottom, fallback),
      left: nonNegative(value.left, fallback),
    };
  }
  const inset = nonNegative(value, fallback);
  return { top: inset, right: inset, bottom: inset, left: inset };
};

/** PDF /RD order is left, bottom, right, top in the local text box. */
export const freeTextPaddingFromPdf = (
  rd: unknown,
  scale = 1,
): Annotation["textPadding"] => {
  if (
    !Array.isArray(rd) ||
    rd.length !== 4 ||
    !rd.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)
  )
    return undefined;
  const [left, bottom, right, top] = (rd as number[]).map((n) => n * scale);
  return left === bottom && left === right && left === top
    ? left
    : { left, bottom, right, top };
};

export const getFreeTextContentBox = (
  annotation: Pick<Annotation, "textPadding" | "borderWidth">,
  width: number,
  height: number,
) => {
  const padding = getFreeTextPadding(annotation);
  return {
    padding,
    x: padding.left,
    y: padding.top,
    width: Math.max(0, width - padding.left - padding.right),
    height: Math.max(0, height - padding.top - padding.bottom),
  };
};

/** Center the font's capital-height box in a line, leaving half-leading above it. */
export const getFreeTextBaseline = (
  fontSize: number,
  lineHeight: number,
  capCenterEm: number,
) => lineHeight / 2 + fontSize * capCenterEm;

/** Shared by the overlay and both PDF output paths; preserve explicit blank lines. */
export const wrapFreeText = (
  text: string,
  width: number,
  measure: (text: string) => number,
): string[] => {
  if (width <= 0) return [];
  const lines: string[] = [];
  const isBreak = (ch: string) =>
    /[\s-]/u.test(ch) || (ch.codePointAt(0) ?? 0) > 0x7f;
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let current: string[] = [];
    let lastBreak = 0;
    for (const ch of paragraph) {
      while (current.length && measure(current.join("") + ch) > width) {
        const at = lastBreak || current.length;
        lines.push(current.slice(0, at).join(""));
        current = current.slice(at);
        lastBreak = 0;
        current.forEach((c, i) => {
          if (isBreak(c)) lastBreak = i + 1;
        });
      }
      current.push(ch);
      if (isBreak(ch)) lastBreak = current.length;
    }
    if (current.length) lines.push(current.join(""));
  }
  return lines;
};
