import React from "react";
import { ChevronDown, Clock3 } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatDuration } from "./utils";

export function TurnActivity({
  durationMs,
  children,
}: {
  durationMs?: number;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <Collapsible
      defaultOpen={false}
      className="min-w-0"
      data-ai-turn-activity=""
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group text-muted-foreground hover:text-foreground hover:bg-muted/60 focus-visible:ring-ring/50 flex max-w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
        >
          <Clock3 size={13} className="shrink-0" />
          <span>
            {durationMs === undefined
              ? t("ai_chat.turn_activity")
              : t("ai_chat.turn_activity_duration", {
                  duration: formatDuration(t, durationMs),
                })}
          </span>
          <ChevronDown
            size={13}
            className="shrink-0 transition-transform group-data-[state=open]:rotate-180"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-border/60 mt-1 ml-3 min-w-0 border-l pl-2">
        <div className="flex min-w-0 flex-col gap-1.5 pb-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
