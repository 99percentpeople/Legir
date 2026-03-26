import { generateText } from "ai";

import { resolveAiSdkLanguageModel } from "@/services/ai/sdk/modelRegistry";
import type { AiSdkModelSpecifier } from "@/services/ai/sdk/types";
import type { AiSummaryInstructions } from "@/services/ai/chat/types";
import { formatSummaryInstructionsForPrompt } from "@/services/ai/utils/promptHelpers";
import type { AppOptions } from "@/types";

type SummarizePageImagesInput = {
  pageNumber: number;
  cropRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  renderedWidth: number;
  renderedHeight: number;
  base64Data: string;
};

const buildPageImageSummaryPrompt = (options: {
  pageNumbers: number[];
  summaryInstructions?: AiSummaryInstructions;
}) => {
  const pageLabel =
    options.pageNumbers.length === 1
      ? `page ${options.pageNumbers[0]}`
      : `pages ${options.pageNumbers.join(", ")}`;
  const summaryInstructionLines = formatSummaryInstructionsForPrompt(
    options.summaryInstructions,
  );

  return [
    `You are reviewing rendered PDF ${pageLabel}.`,
    "",
    "Requirements:",
    "- Describe only what is visible in the rendered pages.",
    "- Focus on layout, tables, diagrams, handwriting, stamps, signatures, annotations, highlights, shapes, and other visual details that text extraction may miss.",
    "- If readable text in the image matters to the request, quote or summarize only the important parts instead of transcribing the whole page.",
    "- Mention page numbers when distinguishing findings across multiple pages.",
    "- If some detail is blurry, cropped, or unreadable, say so instead of guessing.",
    "- Return plain text only. No markdown. No preamble.",
    ...summaryInstructionLines,
  ].join("\n");
};

export const summarizePageImagesWithAiSdk = async (options: {
  appOptions: AppOptions;
  specifier: AiSdkModelSpecifier;
  pages: SummarizePageImagesInput[];
  summaryInstructions?: AiSummaryInstructions;
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
              pageNumbers: options.pages.map((page) => page.pageNumber),
              summaryInstructions: options.summaryInstructions,
            }),
          },
          ...options.pages.flatMap((page) => [
            {
              type: "text" as const,
              text: page.cropRect
                ? `Page ${page.pageNumber} cropped region x=${page.cropRect.x}, y=${page.cropRect.y}, width=${page.cropRect.width}, height=${page.cropRect.height}, rendered at ${page.renderedWidth}x${page.renderedHeight}.`
                : `Page ${page.pageNumber} image rendered at ${page.renderedWidth}x${page.renderedHeight}.`,
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
