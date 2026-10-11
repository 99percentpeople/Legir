import { memo } from "react";
import { Copy, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { useEditorViewApi } from "@/store/useEditorView";
import type { PageAction } from "./types";

export const PageActions = memo(function PageActions({
  ids,
  total,
  enabled,
  compact = false,
  toolbar = false,
  only,
  run,
}: {
  ids: string[];
  total: number;
  enabled: boolean;
  compact?: boolean;
  toolbar?: boolean;
  only?: PageAction;
  run: (action: () => void) => void;
}) {
  const { t } = useLanguage();
  const store = useEditorViewApi();
  const disabled = !enabled || !ids.length;
  const size = compact ? "icon-sm" : toolbar ? "icon" : "default";
  const apply = (action: () => void) =>
    run(() => {
      // Keep per-page edits anchored to the page whose action was clicked.
      if (compact) store.getState().setSelectedPageIds(ids);
      action();
    });
  const actions = [
    {
      id: "clockwise",
      Icon: RotateCw,
      label: t("toolbar.rotate_clockwise"),
      text: t("page_editor.clockwise"),
      action: () => store.getState().rotatePages(ids, 90),
    },
    {
      id: "counterclockwise",
      Icon: RotateCcw,
      label: t("toolbar.rotate_counterclockwise"),
      text: t("page_editor.counterclockwise"),
      action: () => store.getState().rotatePages(ids, -90),
    },
    {
      id: "duplicate",
      Icon: Copy,
      label: t("page_editor.duplicate"),
      text: t("page_editor.duplicate"),
      action: () => store.getState().duplicatePages(ids),
    },
    {
      id: "delete",
      Icon: Trash2,
      label: t("common.actions.delete"),
      text: t("common.actions.delete"),
      action: () => store.getState().deletePages(ids),
    },
  ];
  return (
    <>
      {actions
        .filter(({ id }) => !only || only === id)
        .map(({ id, Icon, label, text, action }) => (
          <Button
            key={id}
            variant="ghost"
            size={size}
            className={toolbar ? "h-8 w-8 sm:h-9 sm:w-9" : undefined}
            disabled={disabled || (id === "delete" && ids.length === total)}
            aria-label={label}
            title={label}
            onClick={() => apply(action)}
          >
            <Icon size={16} />
            {!compact && !toolbar && text}
          </Button>
        ))}
    </>
  );
});
