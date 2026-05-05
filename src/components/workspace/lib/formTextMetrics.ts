let measureCanvas: HTMLCanvasElement | undefined;

export const measureCssTextVisualCenterAboveBaselineEm = (
  text: string | undefined,
  fontFamily: string,
) => {
  if (typeof document === "undefined") return undefined;

  measureCanvas ??= document.createElement("canvas");
  const context = measureCanvas.getContext("2d");
  if (!context) return undefined;

  const fontSize = 100;
  context.font = `normal 400 ${fontSize}px ${fontFamily}`;
  const metrics = context.measureText(text?.length ? text : "Mg");
  const ascent = metrics.actualBoundingBoxAscent;
  const descent = metrics.actualBoundingBoxDescent;
  if (!Number.isFinite(ascent) || !Number.isFinite(descent)) {
    return undefined;
  }
  if (ascent + descent <= 0) return undefined;

  return (ascent - descent) / (2 * fontSize);
};
