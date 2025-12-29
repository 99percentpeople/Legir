import { rgb } from "pdf-lib";
import { pdfDebug } from "./debug";

export const hexToPdfColor = (hex: string | undefined) => {
  if (!hex) return undefined;
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? rgb(
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255,
      )
    : undefined;
};

export const rgbArrayToHex = (
  color: number[] | Uint8ClampedArray | null | undefined,
): string | undefined => {
  if (!color || color.length < 3) return undefined;
  const toHex = (n: number) => {
    const val = Math.max(0, Math.min(255, Math.round(n)));
    return val.toString(16).padStart(2, "0");
  };
  const hex = `#${toHex(color[0])}${toHex(color[1])}${toHex(color[2])}`;
  pdfDebug("import:colors", "rgbArrayToHex", () => ({
    input: [color[0], color[1], color[2]],
    hex,
  }));
  return hex;
};
