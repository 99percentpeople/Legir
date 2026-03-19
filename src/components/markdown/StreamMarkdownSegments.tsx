import React from "react";
import { createPortal } from "react-dom";
import {
  appendTrailingAnchorToHtml,
  TRAILING_ANCHOR_ATTR,
} from "./lib/renderMarkdownHtml";
import type {
  MarkdownTableAlignment,
  StreamingListItemViewModel,
  StreamingListViewModel,
  StreamingSpecialBlockViewModel,
  StreamingTableCellViewModel,
  StreamingTableRowViewModel,
  StreamingTableViewModel,
} from "./lib/types";

export const StaticHtmlSegment = React.memo(function StaticHtmlSegment({
  html,
}: {
  html: string;
}) {
  return (
    <div className="contents" dangerouslySetInnerHTML={{ __html: html }} />
  );
});

export const RenderHtmlSegment = ({
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

const StreamingListItem = React.memo(function StreamingListItem({
  item,
  trailing,
}: {
  item: StreamingListItemViewModel;
  trailing?: React.ReactNode;
}) {
  const hasChildren = item.children.length > 0;
  const contentTrailing = hasChildren ? undefined : trailing;
  const trailingChildIndex = item.children.length - 1;

  return (
    <li>
      {item.contentHtml ? (
        <RenderHtmlSegment html={item.contentHtml} trailing={contentTrailing} />
      ) : (
        contentTrailing
      )}
      {item.children.map((child, index) => (
        <StreamingListSegment
          key={index}
          list={child}
          trailing={index === trailingChildIndex ? trailing : undefined}
        />
      ))}
    </li>
  );
});

const StreamingListSegment = React.memo(function StreamingListSegment({
  list,
  trailing,
}: {
  list: StreamingListViewModel;
  trailing?: React.ReactNode;
}) {
  const isOrdered = list.kind === "ordered";
  const ListTag = isOrdered ? "ol" : "ul";

  return (
    <div className="contents">
      <ListTag
        {...(isOrdered && list.orderedStart
          ? { start: list.orderedStart }
          : {})}
      >
        {list.items.map((item, index) => (
          <StreamingListItem
            key={index}
            item={item}
            trailing={index === list.items.length - 1 ? trailing : undefined}
          />
        ))}
      </ListTag>
    </div>
  );
});

const StreamingTableCell = React.memo(function StreamingTableCell({
  alignment,
  cell,
  tagName,
  trailing,
}: {
  alignment: MarkdownTableAlignment;
  cell: StreamingTableCellViewModel;
  tagName: "td" | "th";
  trailing?: React.ReactNode;
}) {
  const TagName = tagName;

  return (
    <TagName style={alignment ? { textAlign: alignment } : undefined}>
      {cell.html ? (
        <RenderHtmlSegment html={cell.html} trailing={trailing} />
      ) : (
        trailing
      )}
    </TagName>
  );
});

const StreamingTableRow = React.memo(function StreamingTableRow({
  alignments,
  row,
  tagName,
  trailing,
}: {
  alignments: MarkdownTableAlignment[];
  row: StreamingTableRowViewModel;
  tagName: "td" | "th";
  trailing?: React.ReactNode;
}) {
  const trailingCellIndex = row.cells.length - 1;

  return (
    <tr>
      {row.cells.map((cell, index) => (
        <StreamingTableCell
          key={index}
          alignment={alignments[index] ?? null}
          cell={cell}
          tagName={tagName}
          trailing={index === trailingCellIndex ? trailing : undefined}
        />
      ))}
    </tr>
  );
});

const StreamingTableSegment = React.memo(function StreamingTableSegment({
  table,
  trailing,
}: {
  table: StreamingTableViewModel;
  trailing?: React.ReactNode;
}) {
  const hasRows = table.rows.length > 0;

  return (
    <div className="contents">
      <div className="markdown-table-scroll">
        <table>
          <thead>
            <StreamingTableRow
              alignments={table.alignments}
              row={table.header}
              tagName="th"
              trailing={!hasRows ? trailing : undefined}
            />
          </thead>
          {hasRows ? (
            <tbody>
              {table.rows.map((row, index) => (
                <StreamingTableRow
                  key={index}
                  alignments={table.alignments}
                  row={row}
                  tagName="td"
                  trailing={
                    index === table.rows.length - 1 ? trailing : undefined
                  }
                />
              ))}
            </tbody>
          ) : null}
        </table>
      </div>
    </div>
  );
});

export const StreamingSpecialBlockSegment = React.memo(
  function StreamingSpecialBlockSegment({
    block,
    trailing,
  }: {
    block: StreamingSpecialBlockViewModel;
    trailing?: React.ReactNode;
  }) {
    if (block.kind === "list") {
      return (
        <StreamingListSegment list={block.viewModel} trailing={trailing} />
      );
    }

    return (
      <StreamingTableSegment table={block.viewModel} trailing={trailing} />
    );
  },
);
