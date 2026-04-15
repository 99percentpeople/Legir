#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type IconTarget = "all" | "app" | "pdf";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(SCRIPT_DIR, "..");
const APP_ICON_SOURCE = resolve(ROOT_DIR, "public/icons/app-icon.svg");
const PDF_ICON_SOURCE = resolve(ROOT_DIR, "public/icons/pdf-icon.svg");
const APP_ICON_OUTPUT_DIR = resolve(ROOT_DIR, "src-tauri/icons");
const PDF_ICON_TARGETS = [
  {
    source: "icon.ico",
    target: resolve(ROOT_DIR, "src-tauri/icons/pdf-document.ico"),
  },
  {
    source: "icon.icns",
    target: resolve(ROOT_DIR, "src-tauri/icons/pdf-document.icns"),
  },
] as const;

const ICON_TARGETS = new Set<IconTarget>(["all", "app", "pdf"]);

function ensureFileExists(path: string) {
  if (!existsSync(path)) {
    throw new Error(`Missing source file: ${path}`);
  }
}

function runTauriIcon(sourceIcon: string, outDir: string) {
  mkdirSync(outDir, { recursive: true });

  const result = spawnSync(
    process.execPath,
    ["x", "tauri", "icon", sourceIcon, "-o", outDir],
    {
      cwd: ROOT_DIR,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    throw new Error(`tauri icon generation failed for ${sourceIcon}`);
  }
}

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

function createSquareSvg(inputPath: string, outputPath: string) {
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
}

function generateAppIcons() {
  ensureFileExists(APP_ICON_SOURCE);
  runTauriIcon(APP_ICON_SOURCE, APP_ICON_OUTPUT_DIR);

  console.log("Updated app icons from:");
  console.log("  public/icons/app-icon.svg");
}

function generatePdfDocumentIcons() {
  ensureFileExists(PDF_ICON_SOURCE);

  const tempDir = mkdtempSync(join(tmpdir(), "legir-pdf-document-icons-"));
  const squareSvgPath = join(tempDir, "pdf-document-square.svg");
  const generatedOutputDir = join(tempDir, "out");

  try {
    createSquareSvg(PDF_ICON_SOURCE, squareSvgPath);
    runTauriIcon(squareSvgPath, generatedOutputDir);

    for (const { source, target } of PDF_ICON_TARGETS) {
      copyFileSync(join(generatedOutputDir, source), target);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  console.log("Updated:");
  for (const { target } of PDF_ICON_TARGETS) {
    console.log(`  ${target.replace(`${ROOT_DIR}/`, "")}`);
  }
}

function printUsage() {
  console.log("Usage: bun scripts/generate-icons.ts [all|app|pdf]");
}

function parseTarget(argv: string[]): IconTarget {
  const rawTarget = argv[2] ?? "all";

  if (rawTarget === "--help" || rawTarget === "-h") {
    printUsage();
    process.exit(0);
  }

  if (!ICON_TARGETS.has(rawTarget as IconTarget)) {
    printUsage();
    throw new Error(`Unknown icon target: ${rawTarget}`);
  }

  return rawTarget as IconTarget;
}

function main() {
  const target = parseTarget(process.argv);

  if (target === "all" || target === "app") {
    generateAppIcons();
  }

  if (target === "all" || target === "pdf") {
    generatePdfDocumentIcons();
  }

  if (target === "all") {
    console.log("All icons generated.");
  }
}

main();
