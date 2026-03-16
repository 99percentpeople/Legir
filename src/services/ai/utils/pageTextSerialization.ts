import { createViewportFromPageInfo } from "@/services/pdfService/lib/coords";
import {
  DEFAULT_PDF_TEXT_STYLE,
  deltaRotationDeg,
  getAxes,
  getItemTransform,
  intervalDistance,
  isMarkedContent,
  normalizeRotationDeg,
  projectPointsInterval,
  transform,
} from "@/services/pdfService/lib/textGeometry";
import type { TextContent } from "pdfjs-dist/types/src/display/api";
import type { PageData } from "@/types";

type SerializablePageInfo = Pick<PageData, "rotation" | "userUnit" | "viewBox">;

type OrderedTextRun = {
  text: string;
  flatStart: number;
  points: Array<[number, number]>;
  fontSize: number;
  rotationDeg: number;
};

export interface SerializedPageText {
  flatText: string;
  readableText: string;
  readableIndexToFlatIndex: number[];
}

const extractOrderedTextRuns = (
  textContent: TextContent,
  page: SerializablePageInfo,
): SerializedPageText => {
  const viewport = createViewportFromPageInfo(
    {
      viewBox: page.viewBox,
      userUnit: page.userUnit,
      rotation: page.rotation,
    },
    {
      scale: 1,
      rotation: page.rotation,
    },
  );
  const viewBox = viewport.viewBox;

  let flatText = "";
  if (!viewBox) {
    for (const item of textContent.items) {
      if (isMarkedContent(item)) continue;
      flatText += item.str ?? "";
    }
    return {
      flatText,
      readableText: flatText,
      readableIndexToFlatIndex: Array.from(
        { length: flatText.length },
        (_, index) => index,
      ),
    };
  }

  const pageX = viewBox[0];
  const pageY = viewBox[1];
  const pageWidth = viewBox[2] - viewBox[0];
  const pageHeight = viewBox[3] - viewBox[1];
  if (!pageWidth || !pageHeight) {
    for (const item of textContent.items) {
      if (isMarkedContent(item)) continue;
      flatText += item.str ?? "";
    }
    return {
      flatText,
      readableText: flatText,
      readableIndexToFlatIndex: Array.from(
        { length: flatText.length },
        (_, index) => index,
      ),
    };
  }

  const textLayerTransform = [1, 0, 0, -1, -pageX, pageY + pageHeight];
  const runs: OrderedTextRun[] = [];
  let flatOffset = 0;

  for (const item of textContent.items) {
    if (isMarkedContent(item)) continue;

    const text = item.str ?? "";
    const flatStart = flatOffset;
    flatOffset += text.length;
    flatText += text;
    if (!text) continue;

    const itemTransform = getItemTransform(item);
    const tx = transform(textLayerTransform, itemTransform);
    let angle = Math.atan2(tx[1], tx[0]);

    const style = textContent.styles[item.fontName] ?? DEFAULT_PDF_TEXT_STYLE;
    if (style.vertical) {
      angle += Math.PI / 2;
    }

    const rotationDeg = normalizeRotationDeg((angle * 180) / Math.PI);
    const fontHeight = Math.hypot(tx[2], tx[3]) || item.height || 0;
    const ascentRatio =
      Number.isFinite(style.ascent) && typeof style.ascent === "number"
        ? style.ascent
        : Number.isFinite(style.descent) && typeof style.descent === "number"
          ? 1 + style.descent
          : 0.8;
    const fontAscent = fontHeight * ascentRatio;
    const width = style.vertical ? (item.height ?? 0) : (item.width ?? 0);

    let left: number;
    let top: number;
    if (angle === 0) {
      left = tx[4];
      top = tx[5] - fontAscent;
    } else {
      left = tx[4] + fontAscent * Math.sin(angle);
      top = tx[5] - fontAscent * Math.cos(angle);
    }

    const pdfX = left + pageX;
    const pdfYTop = pageY + pageHeight - top;
    const theta = -angle;
    const dxX = width * Math.cos(theta);
    const dxY = width * Math.sin(theta);
    const dyX = fontHeight * Math.sin(theta);
    const dyY = -fontHeight * Math.cos(theta);
    const points = [
      viewport.convertToViewportPoint(pdfX, pdfYTop),
      viewport.convertToViewportPoint(pdfX + dxX, pdfYTop + dxY),
      viewport.convertToViewportPoint(pdfX + dyX, pdfYTop + dyY),
      viewport.convertToViewportPoint(pdfX + dxX + dyX, pdfYTop + dxY + dyY),
    ] as Array<[number, number]>;

    runs.push({
      text,
      flatStart,
      points,
      fontSize: Math.max(1, fontHeight * (page.userUnit ?? 1)),
      rotationDeg,
    });
  }

  let readableText = "";
  const readableIndexToFlatIndex: number[] = [];
  let previousMeaningfulRun: OrderedTextRun | null = null;

  const trimTrailingSpaces = () => {
    while (readableText.endsWith(" ") || readableText.endsWith("\t")) {
      readableText = readableText.slice(0, -1);
      readableIndexToFlatIndex.pop();
    }
  };

  const ensureSyntheticSpace = () => {
    if (!readableText) return;
    const last = readableText[readableText.length - 1];
    if (!last || /\s/u.test(last)) return;
    readableText += " ";
    readableIndexToFlatIndex.push(-1);
  };

  const ensureSyntheticNewline = () => {
    trimTrailingSpaces();
    if (!readableText || readableText.endsWith("\n")) return;
    readableText += "\n";
    readableIndexToFlatIndex.push(-1);
  };

  const inferBoundary = (left: OrderedTextRun, right: OrderedTextRun) => {
    const rotationDiff = Math.abs(
      deltaRotationDeg(left.rotationDeg, right.rotationDeg),
    );
    if (rotationDiff > 22) return "newline" as const;

    const referenceRotation =
      rotationDiff <= 12
        ? normalizeRotationDeg((left.rotationDeg + right.rotationDeg) / 2)
        : left.rotationDeg;
    const { dirX, dirY, normX, normY } = getAxes(referenceRotation);
    const leftU = projectPointsInterval(left.points, dirX, dirY);
    const rightU = projectPointsInterval(right.points, dirX, dirY);
    const leftV = projectPointsInterval(left.points, normX, normY);
    const rightV = projectPointsInterval(right.points, normX, normY);
    const verticalDistance = intervalDistance(leftV, rightV);
    const horizontalGap = rightU.min - leftU.max;
    const fontSize = Math.max(1, Math.min(left.fontSize, right.fontSize));

    if (
      verticalDistance > Math.max(2, fontSize * 0.55) ||
      (horizontalGap < -Math.max(6, fontSize * 0.5) &&
        verticalDistance > Math.max(1, fontSize * 0.15))
    ) {
      return "newline" as const;
    }

    if (horizontalGap > Math.max(1, fontSize * 0.18)) {
      return "space" as const;
    }

    return "none" as const;
  };

  for (const run of runs) {
    const meaningful = /\S/u.test(run.text);

    if (meaningful && previousMeaningfulRun) {
      const boundary = inferBoundary(previousMeaningfulRun, run);
      if (boundary === "newline") {
        ensureSyntheticNewline();
      } else if (boundary === "space") {
        ensureSyntheticSpace();
      }
    }

    if (!meaningful) {
      ensureSyntheticSpace();
      continue;
    }

    for (let index = 0; index < run.text.length; index += 1) {
      readableText += run.text[index]!;
      readableIndexToFlatIndex.push(run.flatStart + index);
    }

    previousMeaningfulRun = run;
  }

  return {
    flatText,
    readableText,
    readableIndexToFlatIndex,
  };
};

export const serializePageTextContent = (
  textContent: TextContent,
  page?: SerializablePageInfo | null,
): SerializedPageText => {
  if (!page) {
    const flatText = textContent.items
      .flatMap((item) =>
        !isMarkedContent(item) && typeof item.str === "string"
          ? [item.str]
          : [],
      )
      .join("");
    return {
      flatText,
      readableText: flatText,
      readableIndexToFlatIndex: Array.from(
        { length: flatText.length },
        (_, index) => index,
      ),
    };
  }

  return extractOrderedTextRuns(textContent, page);
};

export const mapReadableRangeToFlatRange = (
  mapping: number[],
  startOffset: number,
  endOffset: number,
) => {
  if (!Array.isArray(mapping) || mapping.length === 0) return null;

  const start = Math.max(0, Math.min(startOffset, mapping.length));
  const end = Math.max(start, Math.min(endOffset, mapping.length));

  let flatStart = -1;
  let flatEnd = -1;
  for (let index = start; index < end; index += 1) {
    const flatIndex = mapping[index];
    if (typeof flatIndex !== "number" || flatIndex < 0) continue;
    if (flatStart < 0) flatStart = flatIndex;
    flatEnd = flatIndex + 1;
  }

  if (flatStart < 0 || flatEnd <= flatStart) return null;
  return {
    flatStart,
    flatEnd,
  };
};
