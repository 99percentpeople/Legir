import { Sparkles } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Card, CardContent } from "@/components/ui/card";
import { PromptButton } from "./MessagePrimitives";

interface ConversationEmptyStateProps {
  disabledReason: "loading_document" | "no_document" | "no_model" | null;
  onSelectPrompt: (prompt: string) => void;
}

export function ConversationEmptyState({
  disabledReason,
  onSelectPrompt,
}: ConversationEmptyStateProps) {
  const { t } = useLanguage();
  const starterPrompts = [
    t("ai_chat.starters.capabilities"),
    t("ai_chat.starters.whole_document"),
    t("ai_chat.starters.current_page_problem"),
  ];

  return (
    <Card className="mt-auto rounded-none border-none bg-transparent shadow-none">
      <CardContent className="px-3">
        <div className="mb-4 flex items-center gap-2 text-lg font-medium">
          <Sparkles className="size-5" />
          {t("ai_chat.empty_title")}
        </div>
        <div className="text-muted-foreground mb-6 text-sm">
          {disabledReason === "loading_document"
            ? t("app.parsing")
            : disabledReason === "no_document"
              ? t("ai_chat.empty_no_document")
              : disabledReason === "no_model"
                ? t("ai_chat.empty_no_model")
                : t("ai_chat.empty_desc")}
        </div>
        {!disabledReason ? (
          <div className="flex flex-col items-start gap-2">
            {starterPrompts.map((prompt) => (
              <PromptButton
                key={prompt}
                onClick={() => {
                  onSelectPrompt(prompt);
                }}
              >
                {prompt}
              </PromptButton>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
