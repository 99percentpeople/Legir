import "./markdown.css";
import React from "react";
import { createPortal } from "react-dom";
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
  trailing?: React.ReactNode;
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
    // Parsing still belongs to micromark; the streaming splitter only decides
    // which source slices are stable enough to render once and keep.
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

interface MarkdownLineRecord {
  text: string;
  start: number;
  nextStart: number;
}

type MarkdownListKind = "ordered" | "unordered";

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const THEMATIC_BREAK_PATTERN = /^ {0,3}((\* *){3,}|(- *){3,}|(_ *){3,})$/;
const ATX_HEADING_PATTERN = /^ {0,3}#{1,6}(\s|$)/;
const TABLE_DELIMITER_PATTERN =
  /^ {0,3}\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const ORDERED_LIST_ITEM_PATTERN = /^ {0,3}\d+[.)]\s+/;
const UNORDERED_LIST_ITEM_PATTERN = /^ {0,3}[-+*]\s+/;
const BLOCKQUOTE_LINE_PATTERN = /^ {0,3}>\s?/;

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

const getMarkdownLineRecords = (source: string): MarkdownLineRecord[] => {
  const lines: MarkdownLineRecord[] = [];
  let lineStart = 0;

  while (lineStart < source.length) {
    const lineEnd = source.indexOf("\n", lineStart);
    const hasLineBreak = lineEnd >= 0;
    const nextLineStart = hasLineBreak ? lineEnd + 1 : source.length;
    lines.push({
      text: source.slice(lineStart, hasLineBreak ? lineEnd : source.length),
      start: lineStart,
      nextStart: nextLineStart,
    });
    lineStart = nextLineStart;
  }

  return lines;
};

const isPotentialTableRow = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes("|")) return false;
  if (trimmed.startsWith(">")) return false;
  return !FENCE_PATTERN.test(line);
};

const isTableDelimiterRow = (line: string) =>
  TABLE_DELIMITER_PATTERN.test(line.trim());

const getListItemKind = (line: string): MarkdownListKind | null => {
  if (ORDERED_LIST_ITEM_PATTERN.test(line)) return "ordered";
  if (UNORDERED_LIST_ITEM_PATTERN.test(line)) return "unordered";
  return null;
};

const isListContinuationLine = (line: string) => /^(?: {2,}|\t+)/.test(line);
const isBlockquoteLine = (line: string) => BLOCKQUOTE_LINE_PATTERN.test(line);

const pushStableSlice = (
  source: string,
  stableBlocks: string[],
  start: number,
  end: number,
) => {
  if (end <= start) return;
  const block = source.slice(start, end);
  if (block.trim()) {
    stableBlocks.push(block);
  }
};

const getLineStartOffset = (
  lines: MarkdownLineRecord[],
  lineIndex: number,
  sourceLength: number,
) => (lineIndex < lines.length ? lines[lineIndex]!.start : sourceLength);

const resolveStableBlockEnd = (options: {
  lines: MarkdownLineRecord[];
  endLineIndex: number;
  sourceLength: number;
  streaming: boolean;
  trailingOpenStartOffset?: number;
}) => {
  const {
    lines,
    endLineIndex,
    sourceLength,
    streaming,
    trailingOpenStartOffset,
  } = options;
  if (endLineIndex < lines.length) {
    return lines[endLineIndex]!.start;
  }

  // While streaming, keep the last open list/quote item in `pendingSource`
  // so only the mutable tail keeps re-rendering.
  if (streaming && typeof trailingOpenStartOffset === "number") {
    return trailingOpenStartOffset;
  }

  return sourceLength;
};

const scanListBlock = (
  lines: MarkdownLineRecord[],
  startIndex: number,
  listKind: MarkdownListKind,
) => {
  let scanIndex = startIndex + 1;

  while (scanIndex < lines.length) {
    const nextLine = lines[scanIndex]!.text;
    const nextTrimmed = nextLine.trim();
    const nextKind = getListItemKind(nextLine);

    if (nextKind === listKind) {
      scanIndex += 1;
      continue;
    }

    if (nextTrimmed === "" || isListContinuationLine(nextLine)) {
      scanIndex += 1;
      continue;
    }

    break;
  }

  return {
    endLineIndex: scanIndex,
  };
};

const scanTableBlock = (lines: MarkdownLineRecord[], startIndex: number) => {
  let scanIndex = startIndex + 2;
  while (scanIndex < lines.length) {
    const nextLine = lines[scanIndex]!.text;
    if (!isPotentialTableRow(nextLine) || isTableDelimiterRow(nextLine)) {
      break;
    }
    scanIndex += 1;
  }

  return {
    endLineIndex: scanIndex,
  };
};

const scanBlockquoteBlock = (
  lines: MarkdownLineRecord[],
  startIndex: number,
) => {
  const quoteStarts = [startIndex];
  let scanIndex = startIndex + 1;

  while (scanIndex < lines.length) {
    const nextLine = lines[scanIndex]!.text;
    const nextTrimmed = nextLine.trim();

    if (isBlockquoteLine(nextLine)) {
      quoteStarts.push(scanIndex);
      scanIndex += 1;
      continue;
    }

    if (nextTrimmed === "") {
      scanIndex += 1;
      continue;
    }

    break;
  }

  return {
    quoteStarts,
    endLineIndex: scanIndex,
  };
};

const splitMarkdownStream = (
  source: string,
  options?: { streaming?: boolean },
) => {
  const stableBlocks: string[] = [];
  const streaming = options?.streaming ?? false;

  if (!source) {
    return { stableBlocks, pendingSource: "" };
  }

  // Split the stream into immutable blocks plus one mutable tail. React can
  // memoize the committed blocks and only re-render the unfinished suffix.
  const lines = getMarkdownLineRecords(source);
  let blockStart = 0;
  let activeFence: { marker: "`" | "~"; size: number } | null = null;
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const lineRecord = lines[lineIndex]!;
    const line = lineRecord.text;
    const trimmed = line.trim();

    if (activeFence) {
      if (isFenceCloser(line, activeFence)) {
        activeFence = null;
        const block = source.slice(blockStart, lineRecord.nextStart);
        if (block.trim()) {
          stableBlocks.push(block);
        }
        blockStart = lineRecord.nextStart;
      }
    } else {
      const fenceMatch = line.match(FENCE_PATTERN);
      if (fenceMatch) {
        activeFence = {
          marker: fenceMatch[1][0] as "`" | "~",
          size: fenceMatch[1].length,
        };
      } else {
        const currentListKind = getListItemKind(line);
        if (currentListKind) {
          const { endLineIndex } = scanListBlock(
            lines,
            lineIndex,
            currentListKind,
          );

          pushStableSlice(source, stableBlocks, blockStart, lineRecord.start);
          if (blockStart < lineRecord.start) {
            blockStart = lineRecord.start;
          }

          // Keep an open streaming list together as one mutable block. Splitting
          // completed items into committed segments causes the list container to
          // be rebuilt as separate lists, which makes bullets and indentation
          // visibly jump while the model is still typing.
          if (streaming && endLineIndex >= lines.length) {
            lineIndex = lines.length;
          } else {
            const stableEnd = getLineStartOffset(
              lines,
              endLineIndex,
              source.length,
            );
            pushStableSlice(source, stableBlocks, lineRecord.start, stableEnd);

            if (stableEnd > lineRecord.start) {
              blockStart = stableEnd;
              lineIndex =
                stableEnd < source.length ? endLineIndex - 1 : lines.length;
            }
          }
        } else if (
          isPotentialTableRow(line) &&
          lineIndex + 1 < lines.length &&
          isTableDelimiterRow(lines[lineIndex + 1]!.text)
        ) {
          // Tables have a clear structural boundary, so once detected they can
          // usually be committed as one stable block immediately.
          const { endLineIndex } = scanTableBlock(lines, lineIndex);
          const stableEnd = getLineStartOffset(
            lines,
            endLineIndex,
            source.length,
          );
          pushStableSlice(source, stableBlocks, blockStart, lineRecord.start);
          if (blockStart < lineRecord.start) {
            blockStart = lineRecord.start;
          }
          pushStableSlice(source, stableBlocks, lineRecord.start, stableEnd);

          if (stableEnd > lineRecord.start) {
            blockStart = stableEnd;
            lineIndex = endLineIndex - 1;
          }
        } else if (isBlockquoteLine(line)) {
          // Quotes behave like lists here: keep the growing tail mutable, freeze
          // the already-complete prefix.
          const { quoteStarts, endLineIndex } = scanBlockquoteBlock(
            lines,
            lineIndex,
          );
          const stableEnd = resolveStableBlockEnd({
            lines,
            endLineIndex,
            sourceLength: source.length,
            streaming,
            trailingOpenStartOffset:
              lines[quoteStarts[quoteStarts.length - 1]!]!.start,
          });

          pushStableSlice(source, stableBlocks, blockStart, lineRecord.start);
          if (blockStart < lineRecord.start) {
            blockStart = lineRecord.start;
          }
          pushStableSlice(source, stableBlocks, lineRecord.start, stableEnd);

          if (stableEnd > lineRecord.start) {
            blockStart = stableEnd;
            lineIndex =
              stableEnd < source.length ? endLineIndex - 1 : lines.length;
          }
        } else if (trimmed === "") {
          pushStableSlice(
            source,
            stableBlocks,
            blockStart,
            lineRecord.nextStart,
          );
          blockStart = lineRecord.nextStart;
        } else if (
          ATX_HEADING_PATTERN.test(line) ||
          THEMATIC_BREAK_PATTERN.test(line)
        ) {
          pushStableSlice(
            source,
            stableBlocks,
            blockStart,
            lineRecord.nextStart,
          );
          blockStart = lineRecord.nextStart;
        }
      }
    }

    lineIndex += 1;
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

const StaticHtmlSegment = React.memo(function StaticHtmlSegment({
  html,
}: {
  html: string;
}) {
  return (
    <div className="contents" dangerouslySetInnerHTML={{ __html: html }} />
  );
});

const TRAILING_TARGET_SELECTOR = [
  "li",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote p",
  "td",
  "th",
  "pre code",
].join(", ");
const TRAILING_ANCHOR_ATTR = "data-stream-markdown-trailing-anchor";

const appendTrailingAnchorToHtml = (html: string) => {
  if (typeof document === "undefined" || !html.trim()) {
    return html;
  }

  const template = document.createElement("template");
  template.innerHTML = html;
  const anchor = document.createElement("span");
  anchor.setAttribute(TRAILING_ANCHOR_ATTR, "true");
  anchor.className = "inline";

  const matches = template.content.querySelectorAll(TRAILING_TARGET_SELECTOR);
  const target = matches.item(matches.length - 1);
  if (target) {
    // Attach the anchor to the last inline-friendly node so the cursor stays on
    // the current line instead of dropping below block elements like lists.
    target.appendChild(anchor);
  } else {
    template.content.appendChild(anchor);
  }

  return template.innerHTML;
};

const RenderHtmlSegment = ({
  html,
  trailing,
}: {
  html: string;
  trailing?: React.ReactNode;
}) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const htmlWithTrailingAnchor = React.useMemo(
    () => (trailing ? appendTrailingAnchorToHtml(html) : html),
    [html, trailing],
  );
  const portalHost = React.useMemo(
    () =>
      typeof document !== "undefined" ? document.createElement("span") : null,
    [],
  );

  React.useLayoutEffect(() => {
    if (!trailing || !containerRef.current || !portalHost) {
      portalHost?.remove();
      return;
    }

    // The rendered HTML is recreated as tokens arrive, so the cursor must mount
    // into a stable host element that we reattach after each HTML refresh.
    const nextTarget = containerRef.current.querySelector(
      `[${TRAILING_ANCHOR_ATTR}]`,
    );
    if (!(nextTarget instanceof HTMLElement)) {
      portalHost.remove();
      return;
    }

    portalHost.className = "inline";
    if (portalHost.parentElement !== nextTarget) {
      nextTarget.replaceChildren(portalHost);
    }

    return () => {
      portalHost.remove();
    };
  }, [htmlWithTrailingAnchor, portalHost, trailing]);

  return (
    <>
      <div
        ref={containerRef}
        className="contents"
        dangerouslySetInnerHTML={{ __html: htmlWithTrailingAnchor }}
      />
      {trailing && portalHost ? createPortal(trailing, portalHost) : null}
      {trailing && !portalHost ? trailing : null}
    </>
  );
};

export const StreamMarkdown = React.memo(function StreamMarkdown({
  source,
  streaming = false,
  trailing,
  className,
  onClick,
  onOpenDocumentLink,
  ...props
}: StreamMarkdownProps) {
  const segmentedSource = React.useMemo(
    () => splitMarkdownStream(source, { streaming }),
    [source, streaming],
  );
  const { stableBlocks, pendingSource } = segmentedSource;
  const deferredPendingSource = React.useDeferredValue(pendingSource);
  const renderPendingSource =
    streaming &&
    deferredPendingSource.length <= pendingSource.length &&
    pendingSource.startsWith(deferredPendingSource)
      ? deferredPendingSource
      : pendingSource;
  const [committedSegments, setCommittedSegments] = React.useState<
    MarkdownHtmlSegment[]
  >(() => stableBlocks.map(buildMarkdownSegment));

  React.useEffect(() => {
    React.startTransition(() => {
      setCommittedSegments((previous) => {
        // Append-only updates preserve rendered HTML for already-finished blocks.
        // If earlier segmentation changed, fall back to rebuilding from scratch.
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
  const shouldAttachTrailingToCommittedTail =
    Boolean(trailing) && !pendingHtml && committedSegments.length > 0;
  const trailingTargetHtml =
    pendingHtml ||
    (shouldAttachTrailingToCommittedTail
      ? committedSegments.at(-1)?.html || ""
      : "");
  const committedSegmentsToRender = shouldAttachTrailingToCommittedTail
    ? committedSegments.slice(0, -1)
    : committedSegments;

  if (committedSegments.length === 0 && !pendingHtml && !trailing) {
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
      {committedSegmentsToRender.map((segment) => (
        <StaticHtmlSegment key={segment.id} html={segment.html} />
      ))}
      {trailingTargetHtml ? (
        <RenderHtmlSegment html={trailingTargetHtml} trailing={trailing} />
      ) : null}
      {!trailingTargetHtml && trailing ? trailing : null}
    </div>
  );
});
