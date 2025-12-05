import React from "react";
import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Badge } from "./ui/badge";
import { useLanguage } from "./language-provider";

interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useLanguage();

  const categories = [
    {
      title: t("shortcuts.category.general"),
      items: [
        { key: "Ctrl + Z", action: t("toolbar.undo") },
        { key: "Ctrl + Y", action: t("toolbar.redo") },
        { key: "Ctrl + S", action: t("shortcuts.export") },
        { key: "Ctrl + P", action: t("shortcuts.print") },
        { key: "Ctrl + Scroll", action: t("shortcuts.zoom") },
        { key: "Shift + ?", action: t("shortcuts.help") },
        { key: "Escape", action: t("shortcuts.deselect") },
      ],
    },
    {
      title: t("shortcuts.category.editing"),
      items: [
        { key: "Ctrl + C", action: t("shortcuts.copy") },
        { key: "Ctrl + V", action: t("shortcuts.paste") },
        { key: "Ctrl + X", action: t("shortcuts.cut") },
        { key: "Delete / Backspace", action: t("shortcuts.delete") },
        { key: t("shortcuts.ctrl_drag"), action: t("shortcuts.duplicate") },
      ],
    },
    {
      title: t("shortcuts.category.movement"),
      items: [
        {
          key: t("shortcuts.space_drag"),
          action: t("shortcuts.pan"),
        },
        { key: t("shortcuts.arrow_keys"), action: t("shortcuts.move_1px") },
        { key: t("shortcuts.shift_arrow"), action: t("shortcuts.move_10px") },
        {
          key: t("shortcuts.shift_drag_move"),
          action: t("shortcuts.lock_axis"),
        },
        {
          key: t("shortcuts.shift_resize"),
          action: t("shortcuts.maintain_aspect"),
        },
        {
          key: t("shortcuts.alt_drag"),
          action: t("shortcuts.disable_snapping"),
        },
      ],
    },
    {
      title: t("shortcuts.category.creation"),
      items: [
        {
          key: t("shortcuts.shift_drag_create"),
          action: t("shortcuts.draw_square"),
        },
        {
          key: t("shortcuts.ctrl_create"),
          action: t("shortcuts.continuous_mode"),
        },
      ],
    },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            {t("shortcuts.title")}
          </DialogTitle>
          <DialogDescription>{t("shortcuts.desc")}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-6 overflow-y-auto pr-1">
          {categories.map((category, idx) => (
            <div key={idx}>
              <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
                {category.title}
              </h3>
              <div className="border-border overflow-hidden rounded-md border">
                <table className="w-full text-left text-sm">
                  <tbody className="divide-border divide-y">
                    {category.items.map((s, i) => (
                      <tr
                        key={i}
                        className="bg-background hover:bg-muted/30 transition-colors"
                      >
                        <td className="w-[45%] px-4 py-2">
                          <Badge
                            variant="secondary"
                            className="font-mono text-xs whitespace-nowrap"
                          >
                            {s.key}
                          </Badge>
                        </td>
                        <td className="text-foreground px-4 py-2">
                          {s.action}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default KeyboardShortcutsHelp;
