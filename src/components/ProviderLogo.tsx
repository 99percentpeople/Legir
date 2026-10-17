import * as React from "react";

import {
  runtimeProviderId,
  type AiProviderId,
} from "@/services/ai/providers/catalog";
import { cn } from "@/utils/cn";
import { preload, type PreloadableLazyComponent } from "@/utils/preload";

type ProviderLogoIconProps = {
  className?: string;
  size?: number | string;
  title?: string;
  "aria-hidden"?: boolean;
};

const lazyProviderLogo = (
  loader: () => Promise<{
    default: React.ComponentType<ProviderLogoIconProps>;
  }>,
) => preload(loader);

const OpenAiLogo = lazyProviderLogo(
  () => import("@lobehub/icons/es/OpenAI/components/Mono"),
);
const AnthropicLogo = lazyProviderLogo(
  () => import("@lobehub/icons/es/Anthropic/components/Mono"),
);

const providerLogos = {
  openai: OpenAiLogo,
  "openai-compatible": OpenAiLogo,
  anthropic: AnthropicLogo,
  "anthropic-compatible": AnthropicLogo,
  "xiaomi-mimo": lazyProviderLogo(
    () => import("@lobehub/icons/es/XiaomiMiMo/components/Mono"),
  ),
  gemini: lazyProviderLogo(
    () => import("@lobehub/icons/es/Gemini/components/Mono"),
  ),
  openrouter: lazyProviderLogo(
    () => import("@lobehub/icons/es/OpenRouter/components/Mono"),
  ),
  deepseek: lazyProviderLogo(
    () => import("@lobehub/icons/es/DeepSeek/components/Mono"),
  ),
  minimax: lazyProviderLogo(
    () => import("@lobehub/icons/es/Minimax/components/Mono"),
  ),
  zhipu: lazyProviderLogo(
    () => import("@lobehub/icons/es/Zhipu/components/Mono"),
  ),
  groq: lazyProviderLogo(
    () => import("@lobehub/icons/es/Groq/components/Mono"),
  ),
  xai: lazyProviderLogo(() => import("@lobehub/icons/es/XAI/components/Mono")),
} satisfies Record<
  AiProviderId,
  PreloadableLazyComponent<React.ComponentType<ProviderLogoIconProps>>
>;

export async function preloadProviderLogos() {
  await Promise.allSettled(
    [...new Set(Object.values(providerLogos))].map((icon) => icon.preload()),
  );
}

export function ProviderLogo(props: {
  providerId: AiProviderId;
  className?: string;
  size?: number | string;
  title?: string;
}) {
  const { providerId, className, size = 14, title } = props;
  const Icon =
    providerLogos[runtimeProviderId(providerId) as keyof typeof providerLogos];
  const iconClassName = cn("shrink-0", className);

  if (!Icon)
    return (
      <span
        aria-hidden
        className={cn(
          "inline-block rounded-sm bg-current opacity-30",
          className,
        )}
        style={{ width: size, height: size }}
      />
    );

  return (
    <React.Suspense
      fallback={
        <span
          aria-hidden={title ? undefined : true}
          title={title}
          className={cn("inline-block shrink-0", className)}
          style={{ width: size, height: size }}
        />
      }
    >
      <Icon
        size={size}
        title={title}
        aria-hidden={title ? undefined : true}
        className={iconClassName}
      />
    </React.Suspense>
  );
}
