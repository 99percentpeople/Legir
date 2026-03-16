import "./markdown.css";
import React from "react";
import DOMPurify from "dompurify";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import {
  parseAiDocumentLinkHref,
  type AiDocumentLinkTarget,
} from "@/services/ai/utils/documentLinks";
import { cn } from "@/utils/cn";

export interface StreamMarkdownProps extends React.HTMLAttributes<HTMLDivElement> {
  source: string;
  streaming?: boolean;
  onOpenDocumentLink?: (target: AiDocumentLinkTarget) => void;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const shouldOpenInNewTab = (href: string | null) =>
  /^(?:https?:)?\/\//i.test(href ?? "");

const sanitizeMarkdownHtml = (html: string) =>
  DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style"],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ["target", "rel"],
  });

const decorateRenderedHtml = (html: string) => {
  if (typeof document === "undefined") {
    return sanitizeMarkdownHtml(html);
  }

  const template = document.createElement("template");
  template.innerHTML = html;

  for (const table of template.content.querySelectorAll("table")) {
    const parent = table.parentElement;
    if (parent?.classList.contains("markdown-table-scroll")) {
      continue;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "markdown-table-scroll";
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  }

  const sanitizedHtml = sanitizeMarkdownHtml(template.innerHTML);
  const sanitizedTemplate = document.createElement("template");
  sanitizedTemplate.innerHTML = sanitizedHtml;

  for (const anchor of sanitizedTemplate.content.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (shouldOpenInNewTab(href)) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noreferrer noopener");
    } else {
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
    }
  }

  return sanitizedTemplate.innerHTML;
};

const renderMarkdownToHtml = (source: string) => {
  if (!source.trim()) return "";

  try {
    return decorateRenderedHtml(
      micromark(source, {
        allowDangerousHtml: true,
        extensions: [gfm()],
        htmlExtensions: [gfmHtml()],
      }),
    );
  } catch {
    return decorateRenderedHtml(`<p>${escapeHtml(source)}</p>`);
  }
};

interface MarkdownHtmlSegment {
  id: string;
  source: string;
  html: string;
}

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const THEMATIC_BREAK_PATTERN = /^ {0,3}((\* *){3,}|(- *){3,}|(_ *){3,})$/;
const ATX_HEADING_PATTERN = /^ {0,3}#{1,6}(\s|$)/;

const isFenceCloser = (
  line: string,
  fence: { marker: "`" | "~"; size: number },
) => {
  const trimmed = line.trim();
  if (!trimmed.startsWith(fence.marker.repeat(fence.size))) {
    return false;
  }
  return new RegExp(`^${fence.marker}{${fence.size},}\\s*$`).test(trimmed);
};

const splitMarkdownStream = (source: string) => {
  const stableBlocks: string[] = [];

  if (!source) {
    return { stableBlocks, pendingSource: "" };
  }

  let blockStart = 0;
  let lineStart = 0;
  let activeFence: { marker: "`" | "~"; size: number } | null = null;

  while (lineStart < source.length) {
    const lineEnd = source.indexOf("\n", lineStart);
    const hasLineBreak = lineEnd >= 0;
    const nextLineStart = hasLineBreak ? lineEnd + 1 : source.length;
    const line = source.slice(
      lineStart,
      hasLineBreak ? lineEnd : source.length,
    );
    const trimmed = line.trim();

    if (activeFence) {
      if (isFenceCloser(line, activeFence)) {
        activeFence = null;
        const block = source.slice(blockStart, nextLineStart);
        if (block.trim()) {
          stableBlocks.push(block);
        }
        blockStart = nextLineStart;
      }
    } else {
      const fenceMatch = line.match(FENCE_PATTERN);
      if (fenceMatch) {
        activeFence = {
          marker: fenceMatch[1][0] as "`" | "~",
          size: fenceMatch[1].length,
        };
      } else if (trimmed === "") {
        const block = source.slice(blockStart, nextLineStart);
        if (block.trim()) {
          stableBlocks.push(block);
        }
        blockStart = nextLineStart;
      } else if (
        ATX_HEADING_PATTERN.test(line) ||
        THEMATIC_BREAK_PATTERN.test(line)
      ) {
        const block = source.slice(blockStart, nextLineStart);
        if (block.trim()) {
          stableBlocks.push(block);
        }
        blockStart = nextLineStart;
      }
    }

    lineStart = nextLineStart;
  }

  return {
    stableBlocks,
    pendingSource: source.slice(blockStart),
  };
};

const buildMarkdownSegment = (
  source: string,
  index: number,
): MarkdownHtmlSegment => ({
  id: `segment-${index}`,
  source,
  html: renderMarkdownToHtml(source),
});

export const StreamMarkdown = React.memo(function StreamMarkdown({
  source,
  streaming = false,
  className,
  onClick,
  onOpenDocumentLink,
  ...props
}: StreamMarkdownProps) {
  const segmentedSource = React.useMemo(
    () => splitMarkdownStream(source),
    [source],
  );
  const { stableBlocks, pendingSource } = segmentedSource;
  const deferredPendingSource = React.useDeferredValue(pendingSource);
  const renderPendingSource = streaming ? deferredPendingSource : pendingSource;
  const [committedSegments, setCommittedSegments] = React.useState<
    MarkdownHtmlSegment[]
  >(() => stableBlocks.map(buildMarkdownSegment));

  React.useEffect(() => {
    React.startTransition(() => {
      setCommittedSegments((previous) => {
        const canAppend =
          previous.length <= stableBlocks.length &&
          previous.every(
            (segment, index) => segment.source === stableBlocks[index],
          );

        if (canAppend) {
          if (previous.length === stableBlocks.length) {
            return previous;
          }

          return [
            ...previous,
            ...stableBlocks
              .slice(previous.length)
              .map((block, index) =>
                buildMarkdownSegment(block, previous.length + index),
              ),
          ];
        }

        return stableBlocks.map(buildMarkdownSegment);
      });
    });
  }, [stableBlocks]);

  const pendingHtml = React.useMemo(
    () => renderMarkdownToHtml(renderPendingSource),
    [renderPendingSource],
  );

  if (committedSegments.length === 0 && !pendingHtml) {
    return null;
  }

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

  return (
    <div
      {...props}
      className={cn("markdown", className)}
      aria-busy={
        streaming && renderPendingSource !== pendingSource ? true : undefined
      }
      onClick={handleClick}
    >
      {committedSegments.map((segment) => (
        <div
          key={segment.id}
          className="contents"
          dangerouslySetInnerHTML={{ __html: segment.html }}
        />
      ))}
      {pendingHtml ? (
        <div
          className="contents"
          dangerouslySetInnerHTML={{ __html: pendingHtml }}
        />
      ) : null}
    </div>
  );
});
