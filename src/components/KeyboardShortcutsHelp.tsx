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

type ShortcutPlatform = "mac" | "linux" | "windows";

const getPlatform = () => {
  if (typeof navigator === "undefined") return "";
  const userAgentData = (
    navigator as Navigator & {
      userAgentData?: { platform?: string };
    }
  ).userAgentData;

  return userAgentData?.platform || navigator.platform || navigator.userAgent;
};

const getShortcutPlatform = (): ShortcutPlatform => {
  const platform = getPlatform().toLowerCase();

  if (platform.includes("mac")) return "mac";
  if (platform.includes("linux") || platform.includes("x11")) return "linux";
  return "windows";
};

const getModifierLabel = (platform: ShortcutPlatform) => {
  if (platform === "mac") return "⌘";
  if (platform === "linux") return "Control";
  return "Ctrl";
};

const getModifierReplacements = (platform: ShortcutPlatform) => {
  if (platform === "mac") {
    return [
      { pattern: /\bCtrl\b/gi, value: "⌘" },
      { pattern: /\bControl\b/gi, value: "⌘" },
      { pattern: /\bCmd\b/gi, value: "⌘" },
      { pattern: /\bCommand\b/gi, value: "⌘" },
      { pattern: /\bShift\b/gi, value: "⇧" },
      { pattern: /\bAlt\b/gi, value: "⌥" },
      { pattern: /\bOption\b/gi, value: "⌥" },
    ];
  }

  if (platform === "linux") {
    return [
      { pattern: /\bCtrl\b/gi, value: "Control" },
      { pattern: /\bCmd\b/gi, value: "Control" },
      { pattern: /\bCommand\b/gi, value: "Control" },
      { pattern: /\bControl\b/gi, value: "Control" },
      { pattern: /\bShift\b/gi, value: "Shift" },
      { pattern: /\bAlt\b/gi, value: "Alt" },
      { pattern: /\bOption\b/gi, value: "Alt" },
    ];
  }

  return [
    { pattern: /\bCtrl\b/gi, value: "Ctrl" },
    { pattern: /\bCmd\b/gi, value: "Ctrl" },
    { pattern: /\bCommand\b/gi, value: "Ctrl" },
    { pattern: /\bControl\b/gi, value: "Ctrl" },
    { pattern: /\bShift\b/gi, value: "Shift" },
    { pattern: /\bAlt\b/gi, value: "Alt" },
    { pattern: /\bOption\b/gi, value: "Alt" },
  ];
};

const formatShortcutText = (value: string, platform: ShortcutPlatform) => {
  const modifierLabel = getModifierLabel(platform);
  const ctrlCmdPattern = /Ctrl\s*\/\s*Cmd|Ctrl\s*\/\s*Command|Ctrl\/Cmd/gi;
  let nextValue = value.replace(ctrlCmdPattern, modifierLabel);

  for (const replacement of getModifierReplacements(platform)) {
    nextValue = nextValue.replace(replacement.pattern, replacement.value);
  }

  return nextValue;
};

const stripShortcutSuffix = (value: string) =>
  value.replace(/\s*\((?:Ctrl|Control|Cmd|Command|⌘)[^)]+\)\s*$/i, "");

const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useLanguage();
  const platform = getShortcutPlatform();
  const isMac = platform === "mac";
  const formatShortcut = (value: string) => formatShortcutText(value, platform);

  const categories = [
    {
      title: t("shortcuts.category.general"),
      items: [
        {
          key: formatShortcut("Ctrl + Z"),
          action: stripShortcutSuffix(formatShortcut(t("toolbar.undo"))),
        },
        {
          key: isMac
            ? formatShortcut("Ctrl + Shift + Z")
            : formatShortcut("Ctrl + Y"),
          action: stripShortcutSuffix(formatShortcut(t("toolbar.redo"))),
        },
        { key: formatShortcut("Ctrl + S"), action: t("shortcuts.export") },
        { key: formatShortcut("Ctrl + P"), action: t("shortcuts.print") },
        {
          key: formatShortcut("Ctrl / Cmd + F"),
          action: t("shortcuts.search_pdf"),
        },
        {
          key: formatShortcut("Ctrl + Scroll"),
          action: t("shortcuts.zoom"),
        },
        { key: formatShortcut("Shift + ?"), action: t("shortcuts.help") },
        { key: "Escape", action: t("shortcuts.deselect") },
      ],
    },
    {
      title: t("shortcuts.category.editing"),
      items: [
        { key: formatShortcut("Ctrl + C"), action: t("shortcuts.copy") },
        { key: formatShortcut("Ctrl + V"), action: t("shortcuts.paste") },
        { key: formatShortcut("Ctrl + X"), action: t("shortcuts.cut") },
        { key: "Delete / Backspace", action: t("shortcuts.delete") },
        {
          key: formatShortcut(t("shortcuts.ctrl_drag")),
          action: t("shortcuts.duplicate"),
        },
      ],
    },
    {
      title: t("shortcuts.category.movement"),
      items: [
        {
          key: formatShortcut(t("shortcuts.space_drag")),
          action: t("shortcuts.pan"),
        },
        { key: t("shortcuts.arrow_keys"), action: t("shortcuts.move_1px") },
        {
          key: formatShortcut(t("shortcuts.shift_arrow")),
          action: t("shortcuts.move_10px"),
        },
        {
          key: formatShortcut(t("shortcuts.shift_drag_move")),
          action: t("shortcuts.lock_axis"),
        },
        {
          key: formatShortcut(t("shortcuts.shift_resize")),
          action: t("shortcuts.maintain_aspect"),
        },
        {
          key: formatShortcut(t("shortcuts.alt_drag")),
          action: t("shortcuts.disable_snapping"),
        },
      ],
    },
    {
      title: t("shortcuts.category.creation"),
      items: [
        {
          key: formatShortcut(t("shortcuts.shift_drag_create")),
          action: t("shortcuts.draw_square"),
        },
        {
          key: formatShortcut(t("shortcuts.ctrl_create")),
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
