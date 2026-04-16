import * as React from "react";

import type { AiProviderId } from "@/services/ai/sdk/providerCatalog";
import { cn } from "@/utils/cn";

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
) => React.lazy(loader);

const providerLogos = {
  openai: lazyProviderLogo(() => import("@lobehub/icons/es/OpenAI")),
  anthropic: lazyProviderLogo(() => import("@lobehub/icons/es/Anthropic")),
  gemini: lazyProviderLogo(() => import("@lobehub/icons/es/Gemini")),
  openrouter: lazyProviderLogo(() => import("@lobehub/icons/es/OpenRouter")),
  deepseek: lazyProviderLogo(() => import("@lobehub/icons/es/DeepSeek")),
  minimax: lazyProviderLogo(() => import("@lobehub/icons/es/Minimax")),
  zhipu: lazyProviderLogo(() => import("@lobehub/icons/es/Zhipu")),
  groq: lazyProviderLogo(() => import("@lobehub/icons/es/Groq")),
  xai: lazyProviderLogo(() => import("@lobehub/icons/es/XAI")),
} satisfies Record<
  AiProviderId,
  React.LazyExoticComponent<React.ComponentType<ProviderLogoIconProps>>
>;

export function ProviderLogo(props: {
  providerId: AiProviderId;
  className?: string;
  size?: number | string;
  title?: string;
}) {
  const { providerId, className, size = 14, title } = props;
  const Icon = providerLogos[providerId];
  const iconClassName = cn("shrink-0", className);

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
