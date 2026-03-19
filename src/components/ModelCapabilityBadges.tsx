import type { LLMModelCapabilities, LLMModelModality } from "@/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/utils/cn";

type CapabilityToken = {
  key: string;
  label: string;
};

const MODALITY_ORDER: LLMModelModality[] = [
  "text",
  "image",
  "file",
  "audio",
  "video",
];

const MODALITY_LABELS: Partial<Record<LLMModelModality, string>> = {
  text: "TEXT",
  image: "IMG",
  file: "FILE",
  audio: "AUDIO",
  video: "VIDEO",
};

const compareModalities = (left: LLMModelModality, right: LLMModelModality) => {
  const leftIndex = MODALITY_ORDER.indexOf(left);
  const rightIndex = MODALITY_ORDER.indexOf(right);

  if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
  if (leftIndex >= 0) return -1;
  if (rightIndex >= 0) return 1;
  return left.localeCompare(right);
};

export const getModelCapabilityTokens = (
  capabilities?: LLMModelCapabilities,
): CapabilityToken[] => {
  if (!capabilities) return [];

  const modalityTokens = [...capabilities.inputModalities]
    .sort(compareModalities)
    .map((modality) => ({
      key: `input:${modality}`,
      label: MODALITY_LABELS[modality] ?? modality.toUpperCase(),
    }));

  if (!capabilities.supportsToolCalls) {
    return modalityTokens;
  }

  return [
    ...modalityTokens,
    {
      key: "tools",
      label: "TOOLS",
    },
  ];
};

export const getModelCapabilityTitle = (
  capabilities?: LLMModelCapabilities,
) => {
  const tokens = getModelCapabilityTokens(capabilities);
  return tokens.map((token) => token.label).join(" · ");
};

export function ModelCapabilityBadges(props: {
  capabilities?: LLMModelCapabilities;
  className?: string;
}) {
  const tokens = getModelCapabilityTokens(props.capabilities);
  if (tokens.length === 0) return null;

  return (
    <div
      className={cn("flex flex-wrap items-center gap-1", props.className)}
      title={getModelCapabilityTitle(props.capabilities)}
    >
      {tokens.map((token) => (
        <Badge
          key={token.key}
          variant="outline"
          className="text-muted-foreground bg-background/80 px-1.5 py-0 text-[10px] font-medium tracking-[0.08em]"
        >
          {token.label}
        </Badge>
      ))}
    </div>
  );
}
