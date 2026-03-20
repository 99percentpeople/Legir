import Anthropic from "@lobehub/icons/es/Anthropic";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Gemini from "@lobehub/icons/es/Gemini";
import Groq from "@lobehub/icons/es/Groq";
import OpenAI from "@lobehub/icons/es/OpenAI";
import OpenRouter from "@lobehub/icons/es/OpenRouter";
import XAI from "@lobehub/icons/es/XAI";

import type { AiProviderId } from "@/services/ai/sdk/providerCatalog";
import { cn } from "@/utils/cn";

const providerLogos = {
  openai: OpenAI,
  anthropic: Anthropic,
  gemini: Gemini,
  openrouter: OpenRouter,
  deepseek: DeepSeek,
  groq: Groq,
  xai: XAI,
} satisfies Record<
  AiProviderId,
  React.ComponentType<{
    className?: string;
    size?: number | string;
    title?: string;
  }>
>;

export function ProviderLogo(props: {
  providerId: AiProviderId;
  className?: string;
  size?: number | string;
  title?: string;
}) {
  const { providerId, className, size = 14, title } = props;
  const Icon = providerLogos[providerId];

  return (
    <Icon
      size={size}
      title={title}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", className)}
    />
  );
}
