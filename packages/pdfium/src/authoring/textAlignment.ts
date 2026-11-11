import type { TextAlignment } from "./operators.js";

/** PDF /Q codes are the indexes of these horizontal alignment values. */
const alignments = ["left", "center", "right"] as const;
export type TextHorizontalAlignment = (typeof alignments)[number];

/** Preserve missing/invalid values so callers can apply their own fallback. */
export function fromPdfTextAlignment(
  value: number | undefined,
): TextHorizontalAlignment | undefined {
  return value === 0 || value === 1 || value === 2
    ? alignments[value]
    : undefined;
}

export function toPdfTextAlignment(
  value: TextHorizontalAlignment,
): TextAlignment {
  const code = alignments.indexOf(value);
  if (code === -1) throw new Error("Invalid text horizontal alignment");
  return code as TextAlignment;
}
