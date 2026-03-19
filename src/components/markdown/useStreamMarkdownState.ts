import React from "react";
import { renderMarkdownToHtml } from "./lib/renderMarkdownHtml";
import {
  buildStreamingSpecialBlockViewModel,
  reconcileMarkdownSegments,
  splitMarkdownStream,
  startsWithStructurallySensitivePendingBlock,
} from "./lib/streamingMarkdown";
import type {
  MarkdownHtmlSegment,
  StreamMarkdownRenderPlan,
  StreamMarkdownRenderPlanItem,
  StreamingHtmlSegmentSnapshot,
  StreamingSpecialBlockViewModel,
} from "./lib/types";

interface UseStreamMarkdownStateOptions {
  source: string;
  streaming: boolean;
  hasTrailing: boolean;
}

interface StreamMarkdownState {
  hasContent: boolean;
  isBusy: boolean;
  renderPlan: StreamMarkdownRenderPlan;
}

interface BuildRenderPlanOptions {
  completedStreamingSpecialBlock: StreamingSpecialBlockViewModel | null;
  completedStructurallySensitiveHtml: StreamingHtmlSegmentSnapshot | null;
  hasTrailing: boolean;
  pendingHtml: string;
  renderedCommittedSegments: MarkdownHtmlSegment[];
  streamingSpecialBlock: StreamingSpecialBlockViewModel | null;
}

const buildRenderPlan = ({
  completedStreamingSpecialBlock,
  completedStructurallySensitiveHtml,
  hasTrailing,
  pendingHtml,
  renderedCommittedSegments,
  streamingSpecialBlock,
}: BuildRenderPlanOptions): StreamMarkdownRenderPlan => {
  if (streamingSpecialBlock) {
    return {
      committedSegments: renderedCommittedSegments,
      renderTrailingFallback: false,
      tailSegments: [
        {
          kind: "special-block",
          block: streamingSpecialBlock,
          key: "streaming-special-block",
          withTrailing: hasTrailing,
        },
      ],
    };
  }

  if (completedStreamingSpecialBlock) {
    return {
      committedSegments: renderedCommittedSegments.slice(0, -1),
      renderTrailingFallback: false,
      tailSegments: [
        {
          kind: "special-block",
          block: completedStreamingSpecialBlock,
          key: "completed-special-block",
          withTrailing: hasTrailing,
        },
      ],
    };
  }

  const tailSegments: StreamMarkdownRenderPlanItem[] = [];
  let committedSegments = renderedCommittedSegments;

  if (completedStructurallySensitiveHtml) {
    committedSegments = renderedCommittedSegments.slice(0, -1);
    tailSegments.push({
      kind: "html",
      html: completedStructurallySensitiveHtml.html,
      key: "completed-structural-html",
      withTrailing: false,
    });
  }

  if (pendingHtml) {
    tailSegments.push({
      kind: "html",
      html: pendingHtml,
      key: "pending-html",
      withTrailing: hasTrailing,
    });
  } else if (hasTrailing && renderedCommittedSegments.length > 0) {
    committedSegments = renderedCommittedSegments.slice(0, -1);
    tailSegments.push({
      kind: "html",
      html: renderedCommittedSegments.at(-1)?.html || "",
      key: "committed-tail-html",
      withTrailing: true,
    });
  }

  return {
    committedSegments,
    renderTrailingFallback: hasTrailing && tailSegments.length === 0,
    tailSegments,
  };
};

export const useStreamMarkdownState = ({
  source,
  streaming,
  hasTrailing,
}: UseStreamMarkdownStateOptions): StreamMarkdownState => {
  const { stableBlocks, pendingSource } = React.useMemo(
    () => splitMarkdownStream(source, { streaming }),
    [source, streaming],
  );
  const lastStreamingSpecialBlockRef =
    React.useRef<StreamingSpecialBlockViewModel | null>(null);
  const streamingSpecialBlock = React.useMemo(
    () =>
      buildStreamingSpecialBlockViewModel(
        pendingSource,
        lastStreamingSpecialBlockRef.current,
        streaming,
      ),
    [pendingSource, streaming],
  );
  const deferredPendingSource = React.useDeferredValue(pendingSource);
  const shouldBypassDeferredPendingSource =
    streaming &&
    !streamingSpecialBlock &&
    startsWithStructurallySensitivePendingBlock(pendingSource);
  const renderPendingSource =
    !shouldBypassDeferredPendingSource &&
    !streamingSpecialBlock &&
    streaming &&
    deferredPendingSource.length <= pendingSource.length &&
    pendingSource.startsWith(deferredPendingSource)
      ? deferredPendingSource
      : pendingSource;
  const [committedSegments, setCommittedSegments] = React.useState<
    MarkdownHtmlSegment[]
  >(() => reconcileMarkdownSegments([], stableBlocks));

  React.useEffect(() => {
    if (!streamingSpecialBlock) return;
    lastStreamingSpecialBlockRef.current = streamingSpecialBlock;
  }, [streamingSpecialBlock]);

  React.useEffect(() => {
    React.startTransition(() => {
      setCommittedSegments((previous) =>
        reconcileMarkdownSegments(previous, stableBlocks),
      );
    });
  }, [stableBlocks]);

  const renderedCommittedSegments = React.useMemo(
    () => reconcileMarkdownSegments(committedSegments, stableBlocks),
    [committedSegments, stableBlocks],
  );
  const pendingHtml = React.useMemo(
    () =>
      streamingSpecialBlock ? "" : renderMarkdownToHtml(renderPendingSource),
    [renderPendingSource, streamingSpecialBlock],
  );
  const lastStructurallySensitiveHtmlRef =
    React.useRef<StreamingHtmlSegmentSnapshot | null>(null);

  React.useEffect(() => {
    if (
      !streamingSpecialBlock &&
      pendingHtml &&
      startsWithStructurallySensitivePendingBlock(pendingSource)
    ) {
      lastStructurallySensitiveHtmlRef.current = {
        source: pendingSource,
        html: pendingHtml,
      };
    }
  }, [pendingHtml, pendingSource, streamingSpecialBlock]);

  const completedStreamingSpecialBlock =
    !streamingSpecialBlock &&
    lastStreamingSpecialBlockRef.current &&
    renderedCommittedSegments.at(-1)?.source ===
      lastStreamingSpecialBlockRef.current.source
      ? lastStreamingSpecialBlockRef.current
      : null;
  const completedStructurallySensitiveHtml =
    pendingHtml &&
    !streamingSpecialBlock &&
    !completedStreamingSpecialBlock &&
    lastStructurallySensitiveHtmlRef.current &&
    renderedCommittedSegments.at(-1)?.source ===
      lastStructurallySensitiveHtmlRef.current.source
      ? lastStructurallySensitiveHtmlRef.current
      : null;
  const renderPlan = React.useMemo(
    () =>
      buildRenderPlan({
        completedStreamingSpecialBlock,
        completedStructurallySensitiveHtml,
        hasTrailing,
        pendingHtml,
        renderedCommittedSegments,
        streamingSpecialBlock,
      }),
    [
      completedStreamingSpecialBlock,
      completedStructurallySensitiveHtml,
      hasTrailing,
      pendingHtml,
      renderedCommittedSegments,
      streamingSpecialBlock,
    ],
  );

  return {
    hasContent:
      renderPlan.committedSegments.length > 0 ||
      renderPlan.tailSegments.length > 0 ||
      renderPlan.renderTrailingFallback,
    isBusy: streaming && renderPendingSource !== pendingSource,
    renderPlan,
  };
};
