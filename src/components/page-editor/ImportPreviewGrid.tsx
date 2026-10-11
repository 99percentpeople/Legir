import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getThumbnailContents } from "@/services/pdfService/thumbnailRenderer";
import type { ThumbnailContent } from "@/services/pdfService/types";
import type { PageData } from "@/types";
import { useLanguage } from "@/components/language-provider";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/utils/cn";
import { PageThumbnail } from "./PageThumbnail";
import type { ImportedDocument } from "./types";

const CARD_HEIGHT = 144;
const GAP = 8;
const PADDING = 12;
const ROW_HEIGHT = CARD_HEIGHT + GAP;

const ImportThumbnail = memo(function ImportThumbnail({
  imported,
  page,
  cache,
  content,
}: {
  imported: ImportedDocument;
  page: PageData;
  cache: Map<number, string>;
  content: ThumbnailContent;
}) {
  const retain = useCallback(
    (url: string) => {
      cache.set(page.pageIndex, url);
      return true;
    },
    [cache, page.pageIndex],
  );
  return (
    <PageThumbnail
      page={page}
      worker={imported.worker}
      image={cache.get(page.pageIndex)}
      onImage={retain}
      content={content}
    />
  );
});

export function ImportPreviewGrid({
  imported,
  selected,
  onToggle,
}: {
  imported: ImportedDocument;
  selected: ReadonlySet<number>;
  onToggle: (index: number, shiftKey: boolean) => void;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const { pages } = imported.document;
  const contents = useMemo(
    () => getThumbnailContents(imported.document),
    [imported.document],
  );
  const cache = useMemo(() => new Map<number, string>(), [imported]);
  useEffect(
    () => () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    },
    [cache],
  );
  const [viewport, setViewport] = useState({ columns: 3, start: 0, end: 12 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      if (!element.clientWidth) return;
      const columns = Math.max(
        1,
        Math.min(
          3,
          Math.floor((element.clientWidth - PADDING * 2 + GAP) / 112),
        ),
      );
      const rows = Math.ceil(pages.length / columns);
      const top = Math.max(0, element.scrollTop - PADDING);
      const start = Math.max(0, Math.floor(top / ROW_HEIGHT) - 1) * columns;
      const end = Math.min(
        pages.length,
        (Math.ceil((top + element.clientHeight) / ROW_HEIGHT) + 1) * columns,
      );
      const next = {
        columns,
        start: Math.min(start, Math.max(0, rows - 1) * columns),
        end,
      };
      // Scroll within a row without re-rendering the visible thumbnails.
      setViewport((previous) =>
        previous.columns === next.columns &&
        previous.start === next.start &&
        previous.end === next.end
          ? previous
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [pages.length]);

  const { columns, start, end } = viewport;
  const rows = Math.ceil(pages.length / columns);
  return (
    <div
      ref={ref}
      role="region"
      aria-label={t("sidebar.thumbnails")}
      tabIndex={-1}
      className="h-80 max-h-[55dvh] overflow-y-auto overscroll-contain rounded-b-lg outline-none sm:h-96"
      data-import-preview-grid
    >
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridAutoRows: CARD_HEIGHT,
          gap: GAP,
          padding: PADDING,
          paddingTop: PADDING + Math.floor(start / columns) * ROW_HEIGHT,
          paddingBottom:
            PADDING + Math.max(0, rows - Math.ceil(end / columns)) * ROW_HEIGHT,
        }}
      >
        {pages.slice(start, end).map((page) => (
          <div
            key={page.pageIndex}
            data-import-page={page.pageIndex}
            className={cn(
              "has-focus-visible:border-ring has-focus-visible:ring-ring flex min-w-0 flex-col items-center gap-2 rounded-md border p-2 transition-colors has-focus-visible:ring-2",
              selected.has(page.pageIndex)
                ? "border-primary/40 bg-background shadow-xs"
                : "hover:bg-accent/50 border-transparent",
            )}
          >
            <button
              type="button"
              className="flex min-h-0 w-full flex-1 items-center justify-center rounded-sm outline-none"
              aria-label={t("sidebar.page", { page: page.pageIndex + 1 })}
              aria-pressed={selected.has(page.pageIndex)}
              onClick={(event) => onToggle(page.pageIndex, event.shiftKey)}
            >
              <ImportThumbnail
                imported={imported}
                page={page}
                cache={cache}
                content={contents[page.pageIndex]}
              />
            </button>
            <label className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
              <Checkbox
                className="focus-visible:ring-0"
                tabIndex={-1}
                aria-label={t("page_editor.select_page", {
                  page: page.pageIndex + 1,
                })}
                checked={selected.has(page.pageIndex)}
                onClick={(event) => onToggle(page.pageIndex, event.shiftKey)}
              />
              {page.pageIndex + 1}
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
