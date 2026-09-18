import { useEffect, useState, type CSSProperties, type Dispatch } from "react";
import { Copy, Highlighter, Languages, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/language-provider";
import {
  PDF_TEXT_SELECTION_HANDLE_WIDTH_PX,
  PDF_TEXT_SELECTION_HANDLE_DOT_SIZE_PX,
  PDF_TEXT_SELECTION_HANDLE_STEM_WIDTH_PX,
} from "@/constants";
import { QUOTE, type DemoState, type DemoAction } from "./types";
import type { DemoCopy } from "./copy";

/** A staged selection, not a text-selection engine. Handles are decoration only. */
export function DemoTextSelection({
  state,
  copy,
  dispatch,
  onAskSelection,
}: {
  state: DemoState;
  copy: DemoCopy;
  dispatch: Dispatch<DemoAction>;
  onAskSelection: () => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const selected = open || state.translationOpen;
  const scale = state.zoom / 100;
  useEffect(() => setOpen(false), [state.navigationToken, state.tool]);

  const actions = [
    {
      label: t("common.actions.copy"),
      Icon: Copy,
      run: async () => {
        try {
          await navigator.clipboard.writeText(QUOTE);
        } catch {
          // Clipboard access can be unavailable in an embedded browser.
        }
        setOpen(false);
      },
    },
    {
      label: t("toolbar.highlight"),
      Icon: Highlighter,
      run: () => {
        if (!state.highlighted) dispatch({ type: "highlight" });
        setOpen(false);
      },
    },
    {
      label: t("toolbar.translate"),
      Icon: Languages,
      run: () => {
        dispatch({ type: "selection", text: QUOTE });
        dispatch({ type: "translate", open: true, auto: true });
        setOpen(false);
      },
    },
    {
      label: t("toolbar.ask_ai", { text: QUOTE }),
      Icon: Sparkles,
      run: () => {
        onAskSelection();
        setOpen(false);
      },
    },
    {
      label: t("toolbar.search_web", { text: QUOTE }),
      Icon: Search,
      run: () => {
        window.open(
          `https://www.google.com/search?q=${encodeURIComponent(QUOTE)}`,
          "_blank",
          "noopener,noreferrer",
        );
        setOpen(false);
      },
    },
  ];

  return (
    <span className="demo-fixed-selection" data-selected={selected}>
      <button
        type="button"
        className="demo-excerpt-trigger"
        aria-label={copy.preset}
        aria-expanded={selected}
        onClick={() => {
          dispatch({ type: "selection", text: QUOTE });
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <mark data-active={state.highlighted} data-selected={selected}>
          {QUOTE}
        </mark>
      </button>
      {selected && (
        <>
          <span
            className="app-text-selection-handles-layer demo-selection-handles"
            aria-hidden="true"
            style={
              {
                "--app-text-selection-handle-width": `${PDF_TEXT_SELECTION_HANDLE_WIDTH_PX / scale}px`,
                "--app-text-selection-handle-dot-size": `${PDF_TEXT_SELECTION_HANDLE_DOT_SIZE_PX / scale}px`,
                "--app-text-selection-handle-stem-width": `${PDF_TEXT_SELECTION_HANDLE_STEM_WIDTH_PX / scale}px`,
              } as CSSProperties
            }
          >
            {(["start", "end"] as const).map((kind) => (
              <span
                key={kind}
                className="app-text-selection-handle"
                data-handle-kind={kind}
              >
                <span className="app-text-selection-handle__stem" />
                <span className="app-text-selection-handle__dot" />
              </span>
            ))}
          </span>
          {/* Same controls and spacing as WorkspaceTextSelectionPopoverView,
              anchored in the paper instead of portalling outside the demo. */}
          <span
            className="demo-selection-actions bg-popover text-popover-foreground border-border flex items-center gap-1 rounded-md border p-1 shadow-md"
            role="toolbar"
            aria-label={copy.selection}
          >
            {actions.map(({ label, Icon, run }) => (
              <Button
                key={label}
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title={label}
                aria-label={label}
                onClick={() => void run()}
              >
                <Icon size={16} />
              </Button>
            ))}
          </span>
        </>
      )}
    </span>
  );
}
