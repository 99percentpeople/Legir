import {
  renderMarkdownToHtml,
  unwrapSingleParagraphHtml,
} from "./renderMarkdownHtml";
import type {
  MarkdownHtmlSegment,
  MarkdownListKind,
  MarkdownTableAlignment,
  StreamingListItemViewModel,
  StreamingListViewModel,
  StreamingSpecialBlockViewModel,
  StreamingTableCellViewModel,
  StreamingTableRowViewModel,
  StreamingTableViewModel,
} from "./types";

interface MarkdownLineRecord {
  text: string;
  start: number;
  nextStart: number;
}

interface ParsedStreamingListSegment {
  kind: MarkdownListKind;
  orderedStart?: number;
  items: ParsedStreamingListItem[];
}

interface ParsedStreamingListItem {
  children: ParsedStreamingListSegment[];
  contentSource: string;
}

interface ParsedStreamingTableSegment {
  alignments: MarkdownTableAlignment[];
  headerCells: string[];
  rowCells: string[][];
}

interface ParsedListMarker {
  content: string;
  indent: number;
  kind: MarkdownListKind;
  orderedStart?: number;
}

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const THEMATIC_BREAK_PATTERN = /^ {0,3}((\* *){3,}|(- *){3,}|(_ *){3,})$/;
const ATX_HEADING_PATTERN = /^ {0,3}#{1,6}(\s|$)/;
const TABLE_DELIMITER_PATTERN =
  /^ {0,3}\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const ORDERED_LIST_ITEM_PATTERN = /^ {0,3}\d+[.)]\s+/;
const UNORDERED_LIST_ITEM_PATTERN = /^ {0,3}[-+*]\s+/;
const BLOCKQUOTE_LINE_PATTERN = /^ {0,3}>\s?/;
const LIST_MARKER_CAPTURE_PATTERN =
  /^(\s*)(?:(\d+)[.)]|([-+*]))(?:\s+(.*)|\s*)$/;

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

const getLineIndent = (line: string) => {
  const match = line.match(/^(\s*)/);
  return match ? match[1]!.replaceAll("\t", "    ").length : 0;
};

const parseListMarker = (line: string): ParsedListMarker | null => {
  const match = line.match(LIST_MARKER_CAPTURE_PATTERN);
  if (!match) return null;

  const orderedStartRaw = match[2];
  return {
    indent: match[1]!.replaceAll("\t", "    ").length,
    kind: orderedStartRaw ? "ordered" : "unordered",
    orderedStart: orderedStartRaw ? Number(orderedStartRaw) : undefined,
    content: match[4] ?? "",
  };
};

const normalizeListContinuationLine = (line: string, listIndent: number) => {
  const targetIndent = Math.max(2, listIndent + 2);
  let remainingIndent = targetIndent;
  let index = 0;

  while (index < line.length && remainingIndent > 0) {
    const char = line[index];
    if (char === " ") {
      remainingIndent -= 1;
      index += 1;
      continue;
    }
    if (char === "\t") {
      remainingIndent -= 4;
      index += 1;
      continue;
    }
    break;
  }

  return line.slice(index);
};

const parseStreamingListTree = (
  lines: MarkdownLineRecord[],
  startIndex: number,
  marker: ParsedListMarker,
): {
  list: ParsedStreamingListSegment;
  nextIndex: number;
} | null => {
  const items: ParsedStreamingListItem[] = [];
  let currentItem: ParsedStreamingListItem | null = {
    children: [],
    contentSource: marker.content,
  };

  items.push(currentItem);
  let lineIndex = startIndex + 1;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex]!.text;
    const nextMarker = parseListMarker(line);

    if (nextMarker) {
      if (nextMarker.indent < marker.indent) {
        break;
      }

      if (nextMarker.indent === marker.indent) {
        if (nextMarker.kind !== marker.kind) {
          break;
        }

        currentItem = {
          children: [],
          contentSource: nextMarker.content,
        };
        items.push(currentItem);
        lineIndex += 1;
        continue;
      }

      if (!currentItem) {
        return null;
      }

      const childList = parseStreamingListTree(lines, lineIndex, nextMarker);
      if (!childList) {
        return null;
      }

      currentItem.children.push(childList.list);
      lineIndex = childList.nextIndex;
      continue;
    }

    if (!currentItem) {
      return null;
    }

    if (line.trim() === "") {
      currentItem.contentSource = currentItem.contentSource
        ? `${currentItem.contentSource}\n`
        : currentItem.contentSource;
      lineIndex += 1;
      continue;
    }

    const lineIndent = getLineIndent(line);
    if (lineIndent > marker.indent) {
      const normalizedLine = normalizeListContinuationLine(line, marker.indent);
      currentItem.contentSource = currentItem.contentSource
        ? `${currentItem.contentSource}\n${normalizedLine}`
        : normalizedLine;
      lineIndex += 1;
      continue;
    }

    break;
  }

  return {
    list: {
      kind: marker.kind,
      orderedStart: marker.orderedStart,
      items,
    },
    nextIndex: lineIndex,
  };
};

const parseStreamingListSegment = (
  source: string,
): ParsedStreamingListSegment | null => {
  if (!source.trim()) return null;

  const lines = getMarkdownLineRecords(source);
  const firstMarker = parseListMarker(lines[0]?.text ?? "");
  if (!firstMarker || firstMarker.indent > 3) return null;

  const parsedTree = parseStreamingListTree(lines, 0, firstMarker);
  if (!parsedTree || parsedTree.nextIndex !== lines.length) return null;

  return parsedTree.list;
};

const splitMarkdownTableCells = (line: string) => {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let currentCell = "";
  let isEscaped = false;

  for (const char of trimmed) {
    if (isEscaped) {
      currentCell += char;
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      currentCell += char;
      isEscaped = true;
      continue;
    }

    if (char === "|") {
      cells.push(currentCell.trim());
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  cells.push(currentCell.trim());
  return cells;
};

const parseMarkdownTableAlignment = (cell: string): MarkdownTableAlignment => {
  const trimmed = cell.trim();
  if (!/^:?-{3,}:?$/.test(trimmed)) return null;
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
  if (trimmed.endsWith(":")) return "right";
  if (trimmed.startsWith(":")) return "left";
  return null;
};

const parseStreamingTableSegment = (
  source: string,
): ParsedStreamingTableSegment | null => {
  if (!source.trim()) return null;

  const lines = getMarkdownLineRecords(source);
  if (lines.length < 2) return null;

  const headerLine = lines[0]!.text;
  const delimiterLine = lines[1]!.text;
  if (
    !isPotentialTableRow(headerLine) ||
    !isTableDelimiterRow(delimiterLine) ||
    lines.some((line) => !line.text.trim() || !isPotentialTableRow(line.text))
  ) {
    return null;
  }

  const headerCells = splitMarkdownTableCells(headerLine);
  const alignmentCells = splitMarkdownTableCells(delimiterLine);
  const alignments = alignmentCells.map(parseMarkdownTableAlignment);
  const columnCount = Math.max(headerCells.length, alignments.length);

  if (columnCount === 0 || alignments.some((alignment) => alignment === null)) {
    return null;
  }

  const normalizeCells = (cells: string[]) =>
    Array.from({ length: columnCount }, (_, index) => cells[index] ?? "");

  return {
    alignments,
    headerCells: normalizeCells(headerCells),
    rowCells: lines
      .slice(2)
      .map((line) => normalizeCells(splitMarkdownTableCells(line.text))),
  };
};

const buildStreamingListItemViewModel = (
  item: ParsedStreamingListItem,
  previousItem?: StreamingListItemViewModel,
): StreamingListItemViewModel => {
  const children = item.children.map((child, index) =>
    buildStreamingListViewModel(child, previousItem?.children[index]),
  );
  const canReusePreviousItem =
    previousItem &&
    previousItem.contentSource === item.contentSource &&
    previousItem.children.length === children.length &&
    previousItem.children.every((child, index) => child === children[index]);

  if (canReusePreviousItem) {
    return previousItem;
  }

  return {
    children,
    contentHtml:
      previousItem?.contentSource === item.contentSource
        ? previousItem.contentHtml
        : unwrapSingleParagraphHtml(renderMarkdownToHtml(item.contentSource)),
    contentSource: item.contentSource,
  };
};

const buildStreamingListViewModel = (
  parsedList: ParsedStreamingListSegment | null,
  previousList: StreamingListViewModel | null,
): StreamingListViewModel | null => {
  if (!parsedList) {
    return null;
  }

  const canReusePreviousItems =
    previousList?.kind === parsedList.kind &&
    previousList.orderedStart === parsedList.orderedStart;
  const previousItems = canReusePreviousItems ? previousList.items : [];

  return {
    kind: parsedList.kind,
    orderedStart: parsedList.orderedStart,
    items: parsedList.items.map((item, index) =>
      buildStreamingListItemViewModel(item, previousItems[index]),
    ),
  };
};

const buildStreamingTableCellViewModel = (
  source: string,
  previousCell?: StreamingTableCellViewModel,
): StreamingTableCellViewModel =>
  previousCell?.source === source
    ? previousCell
    : {
        html: unwrapSingleParagraphHtml(renderMarkdownToHtml(source)),
        source,
      };

const buildStreamingTableRowViewModel = (
  cells: string[],
  previousRow?: StreamingTableRowViewModel,
): StreamingTableRowViewModel => ({
  cells: cells.map((cell, index) =>
    buildStreamingTableCellViewModel(cell, previousRow?.cells[index]),
  ),
});

const buildStreamingTableViewModel = (
  parsedTable: ParsedStreamingTableSegment | null,
  previousTable: StreamingTableViewModel | null,
): StreamingTableViewModel | null => {
  if (!parsedTable) return null;

  const canReuseRows =
    previousTable &&
    previousTable.alignments.length === parsedTable.alignments.length &&
    previousTable.alignments.every(
      (alignment, index) => alignment === parsedTable.alignments[index],
    );

  return {
    alignments: parsedTable.alignments,
    header: buildStreamingTableRowViewModel(
      parsedTable.headerCells,
      canReuseRows ? previousTable.header : undefined,
    ),
    rows: parsedTable.rowCells.map((row, index) =>
      buildStreamingTableRowViewModel(
        row,
        canReuseRows ? previousTable.rows[index] : undefined,
      ),
    ),
  };
};

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

export const splitMarkdownStream = (
  source: string,
  options?: { streaming?: boolean },
) => {
  const stableBlocks: string[] = [];
  const streaming = options?.streaming ?? false;

  if (!source) {
    return { stableBlocks, pendingSource: "" };
  }

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
        pushStableSlice(source, stableBlocks, blockStart, lineRecord.nextStart);
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
          const { endLineIndex } = scanTableBlock(lines, lineIndex);
          pushStableSlice(source, stableBlocks, blockStart, lineRecord.start);
          if (blockStart < lineRecord.start) {
            blockStart = lineRecord.start;
          }

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
              lineIndex = endLineIndex - 1;
            }
          }
        } else if (isBlockquoteLine(line)) {
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
          pushStableSlice(source, stableBlocks, blockStart, lineRecord.start);
          if (blockStart < lineRecord.start) {
            blockStart = lineRecord.start;
          }

          if (streaming && lineIndex === lines.length - 1) {
            lineIndex = lines.length;
          } else {
            pushStableSlice(
              source,
              stableBlocks,
              lineRecord.start,
              lineRecord.nextStart,
            );
            blockStart = lineRecord.nextStart;
          }
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

export const reconcileMarkdownSegments = (
  previous: MarkdownHtmlSegment[],
  stableBlocks: string[],
) => {
  const canAppend =
    previous.length <= stableBlocks.length &&
    previous.every((segment, index) => segment.source === stableBlocks[index]);

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
};

export const buildStreamingSpecialBlockViewModel = (
  source: string,
  previousBlock: StreamingSpecialBlockViewModel | null,
  streaming: boolean,
): StreamingSpecialBlockViewModel | null => {
  if (!streaming) {
    return null;
  }

  const parsedList = parseStreamingListSegment(source);
  const streamingList = buildStreamingListViewModel(
    parsedList,
    previousBlock?.kind === "list" ? previousBlock.viewModel : null,
  );

  if (streamingList) {
    return {
      kind: "list",
      source,
      viewModel: streamingList,
    };
  }

  const parsedTable = parseStreamingTableSegment(source);
  const streamingTable = buildStreamingTableViewModel(
    parsedTable,
    previousBlock?.kind === "table" ? previousBlock.viewModel : null,
  );

  if (streamingTable) {
    return {
      kind: "table",
      source,
      viewModel: streamingTable,
    };
  }

  return null;
};

export const startsWithStructurallySensitivePendingBlock = (source: string) => {
  if (!source.trim()) return false;

  const firstLine = getMarkdownLineRecords(source)[0]?.text ?? source;
  return (
    ATX_HEADING_PATTERN.test(firstLine) ||
    THEMATIC_BREAK_PATTERN.test(firstLine.trim()) ||
    isBlockquoteLine(firstLine) ||
    FENCE_PATTERN.test(firstLine)
  );
};
