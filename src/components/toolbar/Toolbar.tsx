import React, { useRef, useState } from "react";
import {
  Undo2,
  Redo2,
  Keyboard,
  PanelLeft,
  PanelRight,
  Settings,
  PenTool,
  Edit3,
  LayoutGrid,
  Search,
} from "lucide-react";
import { EditorState } from "@/types";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { cn } from "@/utils/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useLanguage } from "../language-provider";
import ZoomDropdownControl from "./ZoomDropdownControl";
import { pdfViewerScaleToWorkspaceScale } from "@/lib/pdfScale";
import {
  MIN_PAGE_THUMBNAIL_SCALE,
  MAX_PAGE_THUMBNAIL_SCALE,
} from "@/constants";
import { useAppEvent } from "@/hooks/useAppEventBus";
import {
  canPrintPdf,
  canUseModeWithPdfPermissions,
} from "@/lib/pdfPermissions";
import SaveMenu from "./SaveMenu";
import { canSaveAs } from "@/services/platform";
import { useEditorView } from "@/store/useEditorView";
import { selectToolbarState } from "@/store/selectors";
import { useShallow } from "zustand/react/shallow";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useEditorDocumentCommandsRuntime } from "@/app/editorRuntime";
import {
  useEditorPdfSearchToolbar,
  useEditorShellCommands,
} from "@/app/editorShellContext";
import { EditorToolSelector } from "./EditorToolSelector";
import { DocumentPermissionsPopover } from "./DocumentPermissionsPopover";

const Toolbar: React.FC<{
  pageToolsRef: React.Ref<HTMLDivElement>;
  pageFinishRef: React.Ref<HTMLDivElement>;
}> = ({ pageToolsRef, pageFinishRef }) => {
  const { t } = useLanguage();
  const editorState = useEditorView(useShallow(selectToolbarState));
  const {
    mode,
    isDirty,
    canUndo,
    canRedo,
    isSidebarOpen: isFieldListOpen,
    isRightPanelOpen: isPropertiesPanelOpen,
    undo: onUndo,
    redo: onRedo,
    openDialog,
  } = editorState;
  const isMobile = useIsMobile();
  const isDocumentReady = editorState.documentLoadState === "ready";
  const pageMode = mode === "pages";
  const hideModeSelector = isMobile;
  const hideToolSection = isMobile && !pageMode;
  const compactZoomControl = isMobile;
  const {
    zoomIn: onZoomIn,
    zoomOut: onZoomOut,
    fitWidth: onFitWidth,
    fitScreen: onFitScreen,
    exitEditor: onExit,
    changeMode: onModeChange,
    changeTool: onToolChange,
    toggleSidebar: onToggleFieldList,
    toggleRightPanel: onTogglePropertiesPanel,
  } = useEditorShellCommands();
  const {
    save: onSave,
    saveAs: onSaveAs,
    print: onPrint,
    requestCloseCurrentTab: onClose,
  } = useEditorDocumentCommandsRuntime();
  const { openPdfSearch: onOpenSearch, isPdfSearchOpen: isSearchOpen } =
    useEditorPdfSearchToolbar();
  const onOpenShortcuts = () => openDialog("shortcuts");
  const onOpenSettings = () => openDialog("settings");
  const hasSaveAs = useRef(canSaveAs());
  const liveScale =
    mode === "pages"
      ? pdfViewerScaleToWorkspaceScale(editorState.pageThumbnailScale)
      : editorState.scale;
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const isModeAllowed = React.useCallback(
    (candidate: EditorState["mode"]) =>
      isDocumentReady &&
      canUseModeWithPdfPermissions(candidate, editorState.documentPermissions),
    [editorState.documentPermissions, isDocumentReady],
  );
  useAppEvent("workspace:pointerDown", () => {
    setZoomMenuOpen(false);
    setModeMenuOpen(false);
  });

  return (
    <div
      className={cn(
        "bg-workspace-header border-border text-foreground relative z-30 flex h-12 items-center gap-2 border-b px-2 sm:px-4",
        pageMode && "max-[400px]:gap-1",
        hideToolSection ? "justify-between" : "lg:justify-between",
      )}
      data-app-block-modifier-wheel-zoom="1"
      data-editor-main-toolbar
    >
      <div className="flex shrink-0 items-center gap-2 sm:gap-2">
        {!pageMode && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleFieldList}
              className={cn(
                "h-8 w-8 sm:h-9 sm:w-9",
                isFieldListOpen && "bg-accent text-accent-foreground",
              )}
              title={t("toolbar.toggle_sidebar")}
            >
              <PanelLeft size={20} />
            </Button>
          </div>
        )}

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onUndo}
            disabled={!canUndo}
            className="h-8 w-8 sm:h-9 sm:w-9"
            title={t("toolbar.undo")}
          >
            <Undo2 size={20} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRedo}
            disabled={!canRedo}
            className="h-8 w-8 sm:h-9 sm:w-9"
            title={t("toolbar.redo")}
          >
            <Redo2 size={20} />
          </Button>
          {!pageMode && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenSearch}
              disabled={!editorState.hasPages}
              className={cn(
                "h-8 w-8 sm:h-9 sm:w-9",
                isSearchOpen && "bg-accent text-accent-foreground",
              )}
              title={t("toolbar.search_pdf")}
            >
              <Search size={20} />
            </Button>
          )}
        </div>

        <Separator orientation="vertical" />

        <div className="flex items-center gap-1">
          <ZoomDropdownControl
            scale={liveScale}
            disabled={!editorState.hasPages}
            compact={compactZoomControl}
            className={
              pageMode
                ? "max-[400px]:gap-0 max-[400px]:px-1 max-[400px]:text-xs max-[400px]:[&>span]:min-w-0 max-[400px]:[&>svg]:hidden"
                : undefined
            }
            open={zoomMenuOpen}
            onOpenChange={setZoomMenuOpen}
            onZoomIn={onZoomIn}
            onZoomOut={onZoomOut}
            onFitWidth={onFitWidth}
            onFitScreen={onFitScreen}
            onSetZoomPercent={
              mode === "pages"
                ? (percent) => editorState.setPageThumbnailScale(percent / 100)
                : undefined
            }
            minZoomPercent={
              mode === "pages" ? MIN_PAGE_THUMBNAIL_SCALE * 100 : undefined
            }
            maxZoomPercent={
              mode === "pages" ? MAX_PAGE_THUMBNAIL_SCALE * 100 : undefined
            }
          />
        </div>
      </div>

      {pageMode ? (
        <div
          ref={pageToolsRef}
          className="flex min-w-0 flex-1 items-center justify-center"
          data-page-toolbar-host
        />
      ) : (
        !hideToolSection && (
          <div className="flex min-w-0 flex-1 items-center justify-center xl:absolute xl:top-0 xl:left-1/2 xl:h-full xl:flex-none xl:-translate-x-1/2">
            <div className="no-scrollbar flex w-full overflow-x-auto px-1 xl:w-auto">
              <EditorToolSelector
                state={editorState}
                onToolChange={onToolChange}
              />
            </div>
          </div>
        )
      )}

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-1">
          <DocumentPermissionsPopover
            documentPermissions={editorState.documentPermissions}
            sourceDocumentPermissions={editorState.sourceDocumentPermissions}
            pdfOwnerUnlocked={editorState.pdfOwnerUnlocked}
          />

          {!hideModeSelector && (
            <>
              <DropdownMenu
                modal={false}
                open={modeMenuOpen}
                onOpenChange={setModeMenuOpen}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 sm:h-9 sm:w-9"
                    title={t("mode.select")}
                    aria-label={t("mode.select")}
                  >
                    {mode === "pages" ? (
                      <LayoutGrid size={16} />
                    ) : mode === "annotation" ? (
                      <PenTool size={16} />
                    ) : (
                      <Edit3 size={16} />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  data-app-block-modifier-wheel-zoom="1"
                >
                  <DropdownMenuRadioGroup
                    value={mode}
                    onValueChange={(nextMode) => {
                      if (
                        nextMode === "annotation" ||
                        nextMode === "form" ||
                        nextMode === "pages"
                      ) {
                        if (!isModeAllowed(nextMode)) return;
                        onModeChange(nextMode);
                      }
                    }}
                  >
                    <DropdownMenuRadioItem
                      value="annotation"
                      disabled={!isModeAllowed("annotation")}
                    >
                      <div className="flex items-center gap-2">
                        <PenTool size={14} />
                        <span>{t("mode.annotation")}</span>
                      </div>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      value="form"
                      disabled={!isModeAllowed("form")}
                    >
                      <div className="flex items-center gap-2">
                        <Edit3 size={14} />
                        <span>{t("mode.form")}</span>
                      </div>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      value="pages"
                      disabled={!isModeAllowed("pages")}
                    >
                      <div className="flex items-center gap-2">
                        <LayoutGrid size={14} />
                        <span>{t("mode.pages")}</span>
                      </div>
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSettings}
            className="h-8 w-8 sm:h-9 sm:w-9"
            title={t("toolbar.settings")}
          >
            <Settings size={20} />
          </Button>

          {!compactZoomControl && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenShortcuts}
              className="h-8 w-8 sm:h-9 sm:w-9"
              title={t("toolbar.shortcuts")}
            >
              <Keyboard size={20} />
            </Button>
          )}

          {pageMode ? (
            <div
              ref={pageFinishRef}
              className="flex h-8 w-8 shrink-0 items-center sm:h-9 sm:w-9"
              data-page-finish-host
            />
          ) : !editorState.isPanelFloating ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onTogglePropertiesPanel}
              className={cn(
                "h-8 w-8 sm:h-9 sm:w-9",
                isPropertiesPanelOpen && "bg-accent text-accent-foreground",
              )}
              title={t("toolbar.toggle_properties")}
            >
              <PanelRight size={20} />
            </Button>
          ) : (
            !isMobile && (
              // Keep the mode controls anchored when the panel toggle is hidden.
              <div aria-hidden="true" className="h-9 w-9" />
            )
          )}
        </div>

        <SaveMenu
          disabled={!editorState.hasPages || !isDocumentReady}
          isDirty={!!isDirty}
          hasSaveAs={hasSaveAs.current}
          canPrint={
            isDocumentReady && canPrintPdf(editorState.documentPermissions)
          }
          onPrimary={onSave}
          onSaveAs={onSaveAs}
          onExit={onExit}
          onPrint={onPrint}
          onClose={() => {
            if (!isDirty) {
              onExit();
              return;
            }
            onClose();
          }}
        />
      </div>
    </div>
  );
};

export default Toolbar;
