import { memo, useLayoutEffect, useRef, useState } from "react";
import { FileInput, FilePlus2 } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { ResponsiveToolbar } from "@/components/toolbar/ResponsiveToolbar";
import type { ResponsiveToolbarItem } from "@/components/toolbar/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useEditorViewApi } from "@/store/useEditorView";
import { getPageId } from "@/services/pdfService/lib/pageStructure";
import { PageActions } from "./PageActions";
import type { PageAction } from "./types";

const buttonClass = "h-8 w-8 sm:h-9 sm:w-9";
const bulkActions: { id: PageAction; label: string }[] = [
  { id: "clockwise", label: "toolbar.rotate_clockwise" },
  { id: "counterclockwise", label: "toolbar.rotate_counterclockwise" },
  { id: "duplicate", label: "page_editor.duplicate" },
  { id: "delete", label: "common.actions.delete" },
];

export const PageEditorToolbar = memo(function PageEditorToolbar({
  selectedPageIds,
  total,
  enabled,
  busy,
  onOpen,
  run,
}: {
  selectedPageIds: string[];
  total: number;
  enabled: boolean;
  busy: boolean;
  onOpen: (dialog: "blank" | "import") => void;
  run: (action: () => void) => void;
}) {
  const { t } = useLanguage();
  const store = useEditorViewApi();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const count = selectedPageIds.length;
  const allSelected = total > 0 && count === total;
  const selectAllLabel = t(
    allSelected ? "page_editor.clear_selection" : "page_editor.select_all",
  );
  const selectionLabel = count
    ? t("page_editor.selected", { count, total })
    : t("page_editor.total", { count: total });
  const items: ResponsiveToolbarItem[] = [
    {
      id: "import",
      label: t("page_editor.import"),
      content: (
        <Button
          variant="ghost"
          size="icon"
          className={buttonClass}
          disabled={!enabled || busy}
          aria-label={t("page_editor.import")}
          title={t("page_editor.import")}
          onClick={() => onOpen("import")}
        >
          <FileInput size={18} />
        </Button>
      ),
    },
    {
      id: "blank",
      label: t("page_editor.blank"),
      content: (
        <Button
          variant="ghost"
          size="icon"
          className={buttonClass}
          disabled={!enabled || busy}
          aria-label={t("page_editor.blank")}
          title={t("page_editor.blank")}
          onClick={() => onOpen("blank")}
        >
          <FilePlus2 size={18} />
        </Button>
      ),
    },
    ...bulkActions.map(({ id, label }) => ({
      id,
      label: t(label),
      content: (
        <PageActions
          ids={selectedPageIds}
          total={total}
          enabled={enabled && !busy}
          toolbar
          only={id}
          run={run}
        />
      ),
    })),
  ];
  return (
    <div
      className="flex w-full min-w-0 items-center gap-1 sm:gap-2"
      data-page-editor-toolbar
    >
      <div
        className="text-muted-foreground flex h-8 min-w-0 items-center gap-1 text-xs whitespace-nowrap tabular-nums sm:h-9 sm:gap-2"
        title={t("page_editor.hint")}
        data-page-selection
      >
        <Checkbox
          aria-label={selectAllLabel}
          title={selectAllLabel}
          disabled={busy || total === 0}
          checked={allSelected ? true : count > 0 ? "indeterminate" : false}
          onCheckedChange={(checked) =>
            store
              .getState()
              .setSelectedPageIds(
                checked === true ? store.getState().pages.map(getPageId) : [],
              )
          }
        />
        <span
          className="truncate"
          aria-live="polite"
          aria-label={selectionLabel}
          title={selectionLabel}
        >
          {count ? `${count} / ${total}` : total}
        </span>
      </div>
      <div
        ref={ref}
        className="flex min-w-10 flex-1 items-center justify-center"
      >
        <ResponsiveToolbar
          items={items}
          availableWidth={width}
          variant="inline"
          closeOnAction
        />
      </div>
    </div>
  );
});
