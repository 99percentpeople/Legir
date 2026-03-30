import { Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TranslateFn } from "./types";
import { PromptButton } from "./MessagePrimitives";

interface ConversationEmptyStateProps {
  disabledReason: "no_document" | "no_model" | null;
  formToolsEnabled: boolean;
  onSelectPrompt: (prompt: string) => void;
  t: TranslateFn;
}

export function ConversationEmptyState({
  disabledReason,
  formToolsEnabled,
  onSelectPrompt,
  t,
}: ConversationEmptyStateProps) {
  const starterGroups = [
    ...(formToolsEnabled
      ? [
          {
            id: "forms",
            title: t("ai_chat.starters.forms.title"),
            prompts: [
              t("ai_chat.starters.forms.current_page"),
              t("ai_chat.starters.forms.signature_dates"),
            ],
          },
        ]
      : []),
    {
      id: "reading",
      title: t("ai_chat.starters.reading.title"),
      prompts: [
        t("ai_chat.starters.reading.current_page"),
        t("ai_chat.starters.reading.whole_document"),
      ],
    },
    {
      id: "search",
      title: t("ai_chat.starters.search.title"),
      prompts: [
        t("ai_chat.starters.search.keyword"),
        t("ai_chat.starters.search.jump"),
      ],
    },
    {
      id: "actions",
      title: t("ai_chat.starters.actions.title"),
      prompts: [
        t("ai_chat.starters.actions.highlight"),
        t("ai_chat.starters.actions.annotations"),
      ],
    },
  ];

  return (
    <Card className="bg-muted/20 border-dashed">
      <CardContent className="pt-6">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Sparkles size={16} />
          {t("ai_chat.empty_title")}
        </div>
        <div className="text-muted-foreground mb-4 text-sm">
          {disabledReason === "no_document"
            ? t("ai_chat.empty_no_document")
            : disabledReason === "no_model"
              ? t("ai_chat.empty_no_model")
              : t("ai_chat.empty_desc")}
        </div>
        {!disabledReason ? (
          <Tabs defaultValue={starterGroups[0]?.id} className="gap-3">
            <TabsList className="flex h-auto flex-wrap justify-start rounded-xl p-1">
              {starterGroups.map((group) => (
                <TabsTrigger
                  key={group.id}
                  value={group.id}
                  className="min-w-0 flex-none px-3 text-xs sm:text-sm"
                >
                  {group.title}
                </TabsTrigger>
              ))}
            </TabsList>
            {starterGroups.map((group) => (
              <TabsContent
                key={group.id}
                value={group.id}
                className="mt-0 grid gap-2"
              >
                {group.prompts.map((prompt) => (
                  <PromptButton
                    key={prompt}
                    onClick={() => {
                      onSelectPrompt(prompt);
                    }}
                  >
                    {prompt}
                  </PromptButton>
                ))}
              </TabsContent>
            ))}
          </Tabs>
        ) : null}
      </CardContent>
    </Card>
  );
}
