import { generateText } from "ai";

import { resolveAiSdkLanguageModel } from "@/services/ai/providers/modelResolver";
import { AI_PAGE_COORDINATE_CONVENTION } from "@/services/ai/utils/pageCoordinates";
import type { AiSdkModelSpecifier } from "@/services/ai/providers/types";
import type { AppOptions } from "@/types";

type SummarizePageImagesInput = {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  cropRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  pixelDensity: number;
  renderedWidth: number;
  renderedHeight: number;
  base64Data: string;
};

const DEFAULT_VISUAL_REQUEST =
  "Inspect the task-relevant visual structure and include only important regions.";

const buildPageImageSummaryPrompt = (options: {
  pages: SummarizePageImagesInput[];
  request?: string;
}) => {
  const pageNumbers = options.pages.map((page) => page.pageNumber);
  const pageLabel =
    pageNumbers.length === 1
      ? `page ${pageNumbers[0]}`
      : `pages ${pageNumbers.join(", ")}`;
  const request = options.request?.trim() || DEFAULT_VISUAL_REQUEST;
  const pageAttributes = options.pages
    .map(
      (page) =>
        `page ${page.pageNumber}: w=${page.pageWidth}, h=${page.pageHeight}`,
    )
    .join("; ");

  return [
    `You are reviewing rendered PDF ${pageLabel}.`,
    `Request: ${request}`,
    `Page attributes: ${pageAttributes}.`,
    "",
    "Requirements:",
    "- Return compact XML-like visual structure.",
    "- Use only these tags: page, summary, region, text, desc.",
    "- Use short attributes: n, w, h, id, type, box, conf. region type must be one of text, table, image, form, signature, stamp, annotation, other.",
    `- Coordinates use editor page-space as displayed to the user. ${AI_PAGE_COORDINATE_CONVENTION}`,
    '- Use box="x,y,width,height" only when a useful approximate box can be estimated.',
    "- Keep region count small and task-relevant. Avoid a full-page inventory.",
    '- For form-like areas, use type="form" and describe the likely field kind in desc.',
    "- If readable text matters, include only important text in text tags.",
    "- If a detail or geometry is blurry, cropped, unreadable, or uncertain, say so in desc instead of guessing.",
    "- Return plain text only. No markdown. No preamble.",
  ].join("\n");
};

export const summarizePageImagesWithAiSdk = async (options: {
  appOptions: AppOptions;
  specifier: AiSdkModelSpecifier;
  pages: SummarizePageImagesInput[];
  request?: string;
  signal?: AbortSignal;
}) => {
  const model = resolveAiSdkLanguageModel(
    options.appOptions,
    options.specifier,
  );

  const result = await generateText({
    model,
    system:
      "You inspect rendered PDF page images faithfully. Return plain text only. Do not use markdown.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildPageImageSummaryPrompt({
              pages: options.pages,
              request: options.request,
            }),
          },
          ...options.pages.flatMap((page) => [
            {
              type: "text" as const,
              text: page.cropRect
                ? `Page ${page.pageNumber} cropped region x=${page.cropRect.x}, y=${page.cropRect.y}, width=${page.cropRect.width}, height=${page.cropRect.height}, rendered at ${page.renderedWidth}x${page.renderedHeight} with fixed pixel density ${page.pixelDensity}.`
                : `Page ${page.pageNumber} image rendered at ${page.renderedWidth}x${page.renderedHeight} with fixed pixel density ${page.pixelDensity}.`,
            },
            {
              type: "image" as const,
              image: page.base64Data,
            },
          ]),
        ],
      },
    ],
    abortSignal: options.signal,
  });

  return result.text.trim();
};
