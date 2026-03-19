import "./markdown.css";
import React from "react";
import {
  parseAiDocumentLinkHref,
  type AiDocumentLinkTarget,
} from "@/services/ai/utils/documentLinks";
import { cn } from "@/utils/cn";
import {
  RenderHtmlSegment,
  StaticHtmlSegment,
  StreamingSpecialBlockSegment,
} from "./StreamMarkdownSegments";
import { useStreamMarkdownState } from "./useStreamMarkdownState";

export interface StreamMarkdownProps extends React.HTMLAttributes<HTMLDivElement> {
  source: string;
  streaming?: boolean;
  trailing?: React.ReactNode;
  onOpenDocumentLink?: (target: AiDocumentLinkTarget) => void;
}

export const StreamMarkdown = React.memo(function StreamMarkdown({
  source,
  streaming = false,
  trailing,
  className,
  onClick,
  onOpenDocumentLink,
  ...props
}: StreamMarkdownProps) {
  const { hasContent, isBusy, renderPlan } = useStreamMarkdownState({
    source,
    streaming,
    hasTrailing: Boolean(trailing),
  });

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      onClick?.(event);
      if (event.defaultPrevented || !onOpenDocumentLink) return;
      if (!(event.target instanceof Element)) return;

      const anchor = event.target.closest("a[href]");
      if (!anchor || !event.currentTarget.contains(anchor)) return;

      const target = parseAiDocumentLinkHref(anchor.getAttribute("href"));
      if (!target) return;

      event.preventDefault();
      onOpenDocumentLink(target);
    },
    [onClick, onOpenDocumentLink],
  );

  if (!hasContent) {
    return null;
  }

  return (
    <div
      {...props}
      className={cn("markdown", className)}
      aria-busy={isBusy ? true : undefined}
      onClick={handleClick}
    >
      {renderPlan.committedSegments.map((segment) => (
        <StaticHtmlSegment key={segment.id} html={segment.html} />
      ))}
      {renderPlan.tailSegments.map((segment) =>
        segment.kind === "special-block" ? (
          <StreamingSpecialBlockSegment
            key={segment.key}
            block={segment.block}
            trailing={segment.withTrailing ? trailing : undefined}
          />
        ) : (
          <RenderHtmlSegment
            key={segment.key}
            html={segment.html}
            trailing={segment.withTrailing ? trailing : undefined}
          />
        ),
      )}
      {renderPlan.renderTrailingFallback ? trailing : null}
    </div>
  );
});
