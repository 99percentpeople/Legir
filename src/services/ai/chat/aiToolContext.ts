import type { AiDocumentToolContext } from "@/services/ai/chat/documentContextService";
import type { AiInteractionToolContext } from "@/hooks/useAiChatController/toolContext";

type UnionToIntersection<T> = (
  T extends unknown ? (value: T) => void : never
) extends (value: infer I) => void
  ? I
  : never;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type ComposeAiToolContext<TParts extends readonly object[]> = Simplify<
  UnionToIntersection<TParts[number]>
>;

export const composeAiToolContext = <TParts extends readonly object[]>(
  ...parts: TParts
): ComposeAiToolContext<TParts> =>
  Object.assign({}, ...parts) as ComposeAiToolContext<TParts>;

export type AiToolContext = ComposeAiToolContext<
  [AiDocumentToolContext, AiInteractionToolContext]
>;
