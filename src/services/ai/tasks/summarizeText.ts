import { generateText } from "ai";

import { resolveAiSdkLanguageModel } from "@/services/ai/providers/modelRegistry";
import type { AiSdkModelSpecifier } from "@/services/ai/providers/types";
import type { AppOptions } from "@/types";

export const summarizeTextWithAiSdk = async (options: {
  text: string;
  appOptions: AppOptions;
  specifier: AiSdkModelSpecifier;
  prompt?: string;
  system?: string;
  signal?: AbortSignal;
}) => {
  const model = resolveAiSdkLanguageModel(
    options.appOptions,
    options.specifier,
  );
  const prompt = [options.prompt?.trim(), "", "Source text:", options.text]
    .filter(Boolean)
    .join("\n\n");
  const system = [
    "You summarize text faithfully. Return plain text only. Do not use markdown.",
    options.system?.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await generateText({
    model,
    system,
    prompt,
    abortSignal: options.signal,
  });

  return result.text.trim();
};
