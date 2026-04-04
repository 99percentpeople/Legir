#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";

function getAttr(attrs: string, name: string): string | null {
  const regex = new RegExp(`\\s${name}="([^"]*)"`, "i");
  const match = attrs.match(regex);
  return match ? match[1] : null;
}

function parseNumber(value: string): number {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    throw new Error(`Unable to parse numeric value from "${value}"`);
  }
  return Number(match[0]);
}

function getCanvasFromViewBox(
  viewBox: string | null,
  width: string | null,
  height: string | null,
) {
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
      return {
        minX: parts[0],
        minY: parts[1],
        width: parts[2],
        height: parts[3],
        viewBox,
      };
    }
  }

  if (!width || !height) {
    throw new Error("SVG must provide either a valid viewBox or width/height.");
  }

  const parsedWidth = parseNumber(width);
  const parsedHeight = parseNumber(height);
  return {
    minX: 0,
    minY: 0,
    width: parsedWidth,
    height: parsedHeight,
    viewBox: `0 0 ${parsedWidth} ${parsedHeight}`,
  };
}

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  throw new Error(
    "Usage: bun scripts/create-square-svg.ts <input.svg> <output.svg>",
  );
}

const rawSvg = readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
const svgMatch = rawSvg.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>\s*$/i);

if (!svgMatch) {
  throw new Error(`Unable to parse root <svg> from ${inputPath}`);
}

const [, rootAttrs, innerMarkup] = svgMatch;
const xmlnsAttrs = Array.from(
  rootAttrs.matchAll(/\s(xmlns(?::[\w-]+)?|xml:space|version)="([^"]*)"/gi),
  (match) => `${match[1]}="${match[2]}"`,
).join(" ");

const widthAttr = getAttr(rootAttrs, "width");
const heightAttr = getAttr(rootAttrs, "height");
const viewBoxAttr = getAttr(rootAttrs, "viewBox");
const { minX, minY, width, height, viewBox } = getCanvasFromViewBox(
  viewBoxAttr,
  widthAttr,
  heightAttr,
);

const squareSize = Math.max(width, height);
const offsetX = minX + (squareSize - width) / 2;
const offsetY = minY + (squareSize - height) / 2;

const outputSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg ${xmlnsAttrs} width="${squareSize}" height="${squareSize}" viewBox="0 0 ${squareSize} ${squareSize}">
  <svg x="${offsetX}" y="${offsetY}" width="${width}" height="${height}" viewBox="${viewBox}">
${innerMarkup}
  </svg>
</svg>
`;

writeFileSync(outputPath, outputSvg);
