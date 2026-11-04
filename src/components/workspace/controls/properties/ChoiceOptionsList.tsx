import React from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { GripVertical, Minus } from "lucide-react";
import { useLanguage } from "@/components/language-provider";

interface ChoiceOptionsListProps {
  options: readonly string[];
  onReorder: (options: string[]) => void;
  onRemove: (index: number) => void;
}

function OptionRow({
  id,
  index,
  label,
  count,
  onRemove,
}: {
  id: string;
  index: number;
  label: string;
  count: number;
  onRemove: (index: number) => void;
}) {
  const { t } = useLanguage();
  const { ref, handleRef } = useSortable({ id, index, disabled: count < 2 });
  return (
    <div
      ref={ref}
      data-choice-option={label}
      className="relative flex items-center gap-1"
    >
      <button
        ref={handleRef}
        type="button"
        data-choice-option-handle
        data-app-keyboard-handle="choice-option-sort"
        disabled={count < 2}
        aria-label={t("properties.reorder_option", { option: label })}
        title={t("properties.reorder_option", { option: label })}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex w-4 shrink-0 cursor-grab touch-none items-center justify-center self-stretch rounded outline-none focus-visible:ring-2 active:cursor-grabbing disabled:cursor-default disabled:opacity-40"
      >
        <GripVertical size={14} aria-hidden="true" />
      </button>
      <div
        className="bg-muted/50 border-border min-w-0 flex-1 truncate rounded border px-2 py-1.5 text-sm"
        title={label}
      >
        {label}
      </div>
      <button
        type="button"
        data-choice-option-delete
        aria-label={t("properties.remove_option", { option: label })}
        title={t("properties.remove_option", { option: label })}
        onClick={() => onRemove(index)}
        className="text-destructive hover:bg-destructive/10 focus-visible:ring-ring shrink-0 rounded p-1.5 outline-none focus-visible:ring-2"
      >
        <Minus size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/** One undoable update on drop; optimistic sorting owns only the visual preview.
 * Mount with the field ID as key so switching fields cancels an active drag. */
export function ChoiceOptionsList({
  options,
  onReorder,
  onRemove,
}: ChoiceOptionsListProps) {
  const { t } = useLanguage();
  const container = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const before = React.useRef<readonly string[] | null>(null);
  const occurrences = new Map<string, number>();
  const rows = options.map((label) => {
    const occurrence = occurrences.get(label) ?? 0;
    occurrences.set(label, occurrence + 1);
    // Labels are not necessarily unique. Index-only IDs would instead bind a
    // dragged row to its old position after a reorder.
    return { label, id: JSON.stringify([label, occurrence]) };
  });
  return (
    <DragDropProvider
      onBeforeDragStart={(event) => {
        if (container.current?.closest("fieldset[disabled]"))
          event.preventDefault();
      }}
      onDragStart={() => {
        before.current = options;
        setDragging(true);
      }}
      onDragEnd={(event) => {
        setDragging(false);
        const snapshot = before.current;
        before.current = null;
        const { source } = event.operation;
        if (
          event.canceled ||
          !snapshot ||
          !isSortable(source) ||
          container.current?.closest("fieldset[disabled]") ||
          snapshot.length !== options.length ||
          !snapshot.every((option, index) => option === options[index])
        )
          return;
        const from = source.initialIndex;
        const to = source.index;
        if (
          from === to ||
          from < 0 ||
          to < 0 ||
          from >= options.length ||
          to >= options.length
        )
          return;
        const reordered = [...options];
        const [moved] = reordered.splice(from, 1);
        reordered.splice(to, 0, moved);
        onReorder(reordered);
      }}
    >
      <div
        ref={container}
        data-choice-options
        data-app-keyboard-dragging={dragging ? "true" : undefined}
        className="scrollbar-thumb-border mb-2 max-h-40 scrollbar-thin space-y-2 overflow-y-auto pr-1"
      >
        {rows.map(({ id, label }, index) => (
          <OptionRow
            key={id}
            id={id}
            index={index}
            label={label}
            count={options.length}
            onRemove={onRemove}
          />
        ))}
        {!rows.length && (
          <div className="text-muted-foreground py-2 text-center text-xs italic">
            {t("properties.no_options")}
          </div>
        )}
      </div>
    </DragDropProvider>
  );
}
