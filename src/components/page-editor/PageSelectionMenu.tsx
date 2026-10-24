import { useState, type ReactNode } from "react";
import { useLanguage } from "@/components/language-provider";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { PageSelectionIntent } from "./types";

export function PageSelectionMenu({
  children,
  selected,
  canSelectRange,
  disabled,
  onSelect,
  onCopy,
  onPaste,
}: {
  children: ReactNode;
  selected: boolean;
  canSelectRange: () => boolean;
  disabled: boolean;
  onSelect: (intent: PageSelectionIntent) => void;
  onCopy?: () => void;
  onPaste?: () => void;
}) {
  const { t } = useLanguage();
  const [rangeAvailable, setRangeAvailable] = useState(false);
  return (
    <ContextMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) setRangeAvailable(canSelectRange());
      }}
    >
      <ContextMenuTrigger
        asChild
        disabled={disabled}
        onContextMenu={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {onCopy && (
          <ContextMenuItem onSelect={onCopy}>
            {t("common.actions.copy")}
          </ContextMenuItem>
        )}
        {onPaste && (
          <ContextMenuItem onSelect={onPaste}>
            {t("common.actions.paste")}
          </ContextMenuItem>
        )}
        {(onCopy || onPaste) && <ContextMenuSeparator />}
        <ContextMenuItem onSelect={() => onSelect("single")}>
          {t("page_editor.select_only")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onSelect("toggle")}>
          {t(
            selected
              ? "page_editor.remove_selection"
              : "page_editor.add_selection",
          )}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!rangeAvailable}
          onSelect={() => onSelect("range")}
        >
          {t("page_editor.select_range")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onSelect("all")}>
          {t("page_editor.select_all")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onSelect("clear")}>
          {t("page_editor.clear_selection")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
