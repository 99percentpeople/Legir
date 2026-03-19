export interface MarkdownHtmlSegment {
  id: string;
  source: string;
  html: string;
}

export interface StreamingHtmlSegmentSnapshot {
  html: string;
  source: string;
}

export type MarkdownListKind = "ordered" | "unordered";

export interface StreamingListItemViewModel {
  children: StreamingListViewModel[];
  contentHtml: string;
  contentSource: string;
}

export interface StreamingListViewModel {
  items: StreamingListItemViewModel[];
  kind: MarkdownListKind;
  orderedStart?: number;
}

export type MarkdownTableAlignment = "center" | "left" | "right" | null;

export interface StreamingTableCellViewModel {
  html: string;
  source: string;
}

export interface StreamingTableRowViewModel {
  cells: StreamingTableCellViewModel[];
}

export interface StreamingTableViewModel {
  alignments: MarkdownTableAlignment[];
  header: StreamingTableRowViewModel;
  rows: StreamingTableRowViewModel[];
}

export type StreamingSpecialBlockViewModel =
  | {
      kind: "list";
      source: string;
      viewModel: StreamingListViewModel;
    }
  | {
      kind: "table";
      source: string;
      viewModel: StreamingTableViewModel;
    };

export type StreamMarkdownRenderPlanItem =
  | {
      kind: "html";
      html: string;
      key: string;
      withTrailing: boolean;
    }
  | {
      kind: "special-block";
      block: StreamingSpecialBlockViewModel;
      key: string;
      withTrailing: boolean;
    };

export interface StreamMarkdownRenderPlan {
  committedSegments: MarkdownHtmlSegment[];
  renderTrailingFallback: boolean;
  tailSegments: StreamMarkdownRenderPlanItem[];
}
