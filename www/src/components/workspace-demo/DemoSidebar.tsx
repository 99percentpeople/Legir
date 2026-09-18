import { useState, type Dispatch } from "react";
import { LayoutGrid, Layers, List, Search, StickyNote, X } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import DocumentOutlinePanel from "@/components/sidebar/OutlinePanel";
import FieldTreePanel from "@/components/sidebar/FieldTreePanel";
import { AnnotationsPanelView } from "@/components/sidebar/AnnotationsPanelView";
import { scrollSidebarItem } from "./scrollSidebarItem";
import { useResizableSidePanel } from "@/hooks/useResizableSidePanel";
import {
  LEFT_SIDEBAR_MIN_WIDTH_PX,
  LEFT_SIDEBAR_MAX_WIDTH_PX,
} from "@/constants";
import {
  INTRO,
  PAGE_TITLES,
  PARAGRAPH,
  QUOTE,
  type DemoAction,
  type DemoState,
  type SidebarView,
} from "./types";
import type { DemoCopy } from "./copy";
import { DEMO_PAGES } from "./geometry";
import {
  DEMO_ANNOTATION_ID,
  DEMO_OUTLINE,
  demoAnnotations,
  demoFormFields,
  isDemoField,
} from "./sourceData";
import { DemoThumbnails } from "./DemoThumbnails";

const VIEWS = ["thumbnails", "outline", "fields", "annotations"] as const;
const ICONS = {
  thumbnails: LayoutGrid,
  outline: List,
  fields: Layers,
  annotations: StickyNote,
};
const CONTENT_CLASS =
  "mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden";

export function DemoSidebar({
  state,
  dispatch,
  copy,
  width,
  onResize,
  floating,
}: {
  state: DemoState;
  dispatch: Dispatch<DemoAction>;
  copy: DemoCopy;
  width: number;
  onResize: (width: number) => void;
  floating: boolean;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const { handleMouseDown, isResizing } = useResizableSidePanel({
    side: "left",
    isOpen: true,
    width,
    minWidth: LEFT_SIDEBAR_MIN_WIDTH_PX,
    maxWidth: LEFT_SIDEBAR_MAX_WIDTH_PX,
    onResize,
    onCollapse: () => dispatch({ type: "hide-sidebar" }),
    cursorSource: "www-sidebar-resize",
  });
  const selectField = (id: string) => {
    if (!isDemoField(id)) return;
    dispatch({ type: "select-field", field: id });
    requestAnimationFrame(() => {
      const field = document.getElementById(`demo-${id}`);
      field?.focus({ preventScroll: true });
      const stage = field?.closest<HTMLElement>(".demo-stage");
      if (!field || !stage) return;
      const rect = field.getBoundingClientRect();
      const viewport = stage.getBoundingClientRect();
      if (rect.top < viewport.top || rect.bottom > viewport.bottom - 80)
        stage.scrollTop += rect.top - viewport.top - 80;
    });
  };
  const results = PAGE_TITLES.flatMap((title, index) =>
    (title + (index === 0 ? INTRO + PARAGRAPH + QUOTE : ""))
      .toLowerCase()
      .includes(query.trim().toLowerCase())
      ? [{ title, page: index + 1 }]
      : [],
  );
  return (
    <aside
      className={`demo-sidebar ${floating ? "demo-sidebar-floating" : ""}`}
      style={{ width }}
      aria-label={t(`sidebar.${state.sidebarView}`)}
    >
      <Tabs
        value={state.sidebarView}
        onValueChange={(value) => {
          dispatch({ type: "sidebar", view: value as SidebarView });
          setQuery("");
        }}
        className="flex h-full flex-col"
      >
        <div className="bg-muted/30 border-border flex shrink-0 items-center justify-between gap-2 border-b p-2">
          {state.sidebarView === "search" ? (
            <div className="relative min-w-0 flex-1">
              <Search size={14} className="absolute top-2.5 left-2" />
              <Input
                className="h-8 pl-7 text-xs"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("toolbar.search_pdf")}
                aria-label={t("toolbar.search_pdf")}
              />
            </div>
          ) : (
            <TabsList className="flex h-8 flex-1 justify-end">
              {VIEWS.map((view) => {
                const Icon = ICONS[view];
                return (
                  <TabsTrigger
                    key={view}
                    value={view}
                    className="data-[state=active]:bg-muted h-full w-9 p-0 text-xs"
                    title={t(`sidebar.${view}`)}
                    aria-label={t(`sidebar.${view}`)}
                  >
                    <Icon size={16} />
                  </TabsTrigger>
                );
              })}
            </TabsList>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            title={t(
              state.sidebarView === "search"
                ? "sidebar.exit_search"
                : "common.actions.close",
            )}
            aria-label={t("common.actions.close")}
            onClick={() =>
              state.sidebarView === "search"
                ? dispatch({ type: "sidebar", view: "thumbnails" })
                : dispatch({ type: "hide-sidebar" })
            }
          >
            <X size={16} />
          </Button>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <TabsContent value="thumbnails" className={CONTENT_CLASS}>
            <DemoThumbnails state={state} copy={copy} dispatch={dispatch} />
          </TabsContent>
          <TabsContent value="outline" className={CONTENT_CLASS}>
            <DocumentOutlinePanel
              outline={DEMO_OUTLINE}
              currentPageIndex={state.page - 1}
              scrollIntoView={scrollSidebarItem}
              onNavigate={(pageIndex) =>
                dispatch({ type: "page", page: pageIndex + 1 })
              }
            />
          </TabsContent>
          <TabsContent value="fields" className={CONTENT_CLASS}>
            <FieldTreePanel
              pages={DEMO_PAGES}
              fields={demoFormFields(state, copy)}
              selectedId={state.selectedField}
              onSelectControl={selectField}
            />
          </TabsContent>
          <TabsContent value="annotations" className={CONTENT_CLASS}>
            <AnnotationsPanelView
              annotations={demoAnnotations(state)}
              canEditAnnotations
              restrictedTitle=""
              scrollIntoView={scrollSidebarItem}
              selectedId={state.selectedAnnotation ? DEMO_ANNOTATION_ID : null}
              onSelectControl={() => dispatch({ type: "select-annotation" })}
              onDeleteAnnotation={() => {
                if (state.highlighted) dispatch({ type: "highlight" });
              }}
              onUpdateAnnotation={(_, updates) => {
                if (typeof updates.text === "string")
                  dispatch({ type: "annotation-text", text: updates.text });
              }}
              onAddAnnotationReply={(_, reply) =>
                dispatch({
                  type: "annotation-replies",
                  replies: [...state.replies, reply],
                })
              }
              onUpdateAnnotationReply={(_, id, updates) =>
                dispatch({
                  type: "annotation-replies",
                  replies: state.replies.map((reply) =>
                    reply.id === id ? { ...reply, ...updates } : reply,
                  ),
                })
              }
              onDeleteAnnotationReply={(_, id) =>
                dispatch({
                  type: "annotation-replies",
                  replies: state.replies.filter((reply) => reply.id !== id),
                })
              }
            />
          </TabsContent>
          <TabsContent value="search" className={CONTENT_CLASS}>
            <div className="demo-sidebar-scroll">
              {query.trim() &&
                (results.length ? (
                  results.map(({ title, page }) => (
                    <Button
                      variant="ghost"
                      className="h-auto w-full flex-col items-start gap-1 p-2 whitespace-normal"
                      key={title}
                      onClick={() => dispatch({ type: "page", page })}
                    >
                      <span className="text-muted-foreground text-xs">
                        {t("sidebar.page", { page })}
                      </span>
                      {title}
                    </Button>
                  ))
                ) : (
                  <p className="demo-empty-note">{t("sidebar.no_results")}</p>
                ))}
            </div>
          </TabsContent>
        </div>
      </Tabs>
      <div
        className="hover:bg-primary/50 absolute top-0 right-0 bottom-0 z-50 w-1 cursor-col-resize"
        onMouseDown={handleMouseDown}
      />
      {isResizing && <div className="fixed inset-0 z-9999 cursor-col-resize" />}
    </aside>
  );
}
