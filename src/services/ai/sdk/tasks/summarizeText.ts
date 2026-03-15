import { generateText } from "ai";

import { resolveAiSdkLanguageModel } from "@/services/ai/sdk/modelRegistry";
import type { AiSdkModelSpecifier } from "@/services/ai/sdk/types";
import type { AppOptions } from "@/types";

export const summarizeTextWithAiSdk = async (options: {
  text: string;
  appOptions: AppOptions;
  specifier: AiSdkModelSpecifier;
  prompt?: string;
  signal?: AbortSignal;
}) => {
  const model = resolveAiSdkLanguageModel(
    options.appOptions,
    options.specifier,
  );
  const prompt = [options.prompt?.trim(), "", "Source text:", options.text]
    .filter(Boolean)
    .join("\n\n");

  const result = await generateText({
    model,
    system:
      "You summarize text faithfully. Return plain text only. Do not use markdown.",
    prompt,
    abortSignal: options.signal,
  });

  return result.text.trim();
};
