import type { CSSProperties, Dispatch } from "react";
import { useLanguage } from "@/components/language-provider";
import { PAGE_TITLES, type DemoAction, type DemoState } from "./types";
import type { DemoCopy } from "./copy";
import { DemoDocumentContent } from "./DemoDocumentContent";
import { DemoTextSelection } from "./DemoTextSelection";

type Props = {
  state: DemoState;
  dispatch: Dispatch<DemoAction>;
  copy: DemoCopy;
  onAskSelection: () => void;
};
export function DemoDocument({ state, dispatch, copy, onAskSelection }: Props) {
  const { t } = useLanguage();
  return (
    <article
      className="demo-paper"
      lang="en"
      aria-label={`${t("sidebar.page", { page: state.page })} — ${PAGE_TITLES[state.page - 1]}`}
      style={
        {
          "--demo-zoom": state.zoom / 100,
          "--demo-highlight": state.highlightColor,
        } as CSSProperties
      }
      data-editor-mode={state.editorMode}
      data-selected-field={state.selectedField}
    >
      <DemoDocumentContent
        state={state}
        copy={copy}
        dispatch={dispatch}
        quote={
          <DemoTextSelection
            state={state}
            copy={copy}
            dispatch={dispatch}
            onAskSelection={onAskSelection}
          />
        }
      />
    </article>
  );
}
