import { AiChatPanel } from "@/components/properties-panel/AiChatPanel";
import { PageTranslatePanel } from "@/components/properties-panel/PageTranslatePanel";
import { PropertiesPanel } from "@/components/properties-panel/PropertiesPanel";
import type {
  Annotation,
  EditorState,
  EditorUiState,
  FormField,
  PDFDocumentPermissions,
  PDFMetadata,
} from "@/types";
import type { EditorUiStateSetter, SelectedEditorControl } from "./types";

interface EditorRightPanelProps {
  canRenderRightPanel: boolean;
  rightPanelTab: EditorUiState["rightPanelTab"];
  isPanelFloating: boolean;
  isRightPanelOpen: boolean;
  rightPanelWidth: number;
  selectedControl: SelectedEditorControl;
  metadata: PDFMetadata;
  filename: string;
  pagesLength: number;
  pageTranslateOptions: EditorUiState["pageTranslateOptions"];
  pageTranslateParagraphCandidates: EditorState["pageTranslateParagraphCandidates"];
  pageTranslateSelectedParagraphIds: EditorState["pageTranslateSelectedParagraphIds"];
  translateOption: EditorState["translateOption"];
  translateTargetLanguage: EditorState["translateTargetLanguage"];
  effectiveLanguage: string;
  isPageTranslating: boolean;
  pageTranslateStatus: string | null;
  documentPermissions?: PDFDocumentPermissions | null;
  aiChat: ReturnType<
    typeof import("@/hooks/useAiChatController").useAiChatController
  >;
  onSetUiState: EditorUiStateSetter;
  onSelectControl: (id: string | null) => void;
  onDeleteSelection: () => void;
  onSaveCheckpoint: () => void;
  onPropertiesChange: (updates: Partial<FormField | Annotation>) => void;
  onMetadataChange: (updates: Partial<PDFMetadata>) => void;
  onFilenameChange: (name: string) => void;
  onStartPageTranslate: (opts: unknown) => void;
  onPreviewParagraphs: (opts: unknown) => void;
  onUnmergeSelectedParagraphs: () => void;
  onCancelPageTranslate: () => void;
  onClearPageTranslateParagraphCandidates: () => void;
  onMergeSelectedPageTranslateParagraphs: () => void;
  onToggleExcludeSelectedPageTranslateParagraphs: () => void;
  onDeleteSelectedPageTranslateParagraphs: () => void;
  onSetAllFreetextFlatten: (value: boolean) => void;
}

export function EditorRightPanel({
  canRenderRightPanel,
  rightPanelTab,
  isPanelFloating,
  isRightPanelOpen,
  rightPanelWidth,
  selectedControl,
  metadata,
  filename,
  pagesLength,
  pageTranslateOptions,
  pageTranslateParagraphCandidates,
  pageTranslateSelectedParagraphIds,
  translateOption,
  translateTargetLanguage,
  effectiveLanguage,
  isPageTranslating,
  pageTranslateStatus,
  documentPermissions,
  aiChat,
  onSetUiState,
  onSelectControl,
  onDeleteSelection,
  onSaveCheckpoint,
  onPropertiesChange,
  onMetadataChange,
  onFilenameChange,
  onStartPageTranslate,
  onPreviewParagraphs,
  onUnmergeSelectedParagraphs,
  onCancelPageTranslate,
  onClearPageTranslateParagraphCandidates,
  onMergeSelectedPageTranslateParagraphs,
  onToggleExcludeSelectedPageTranslateParagraphs,
  onDeleteSelectedPageTranslateParagraphs,
  onSetAllFreetextFlatten,
}: EditorRightPanelProps) {
  if (!canRenderRightPanel) return null;

  const openPanel = () => {
    onSetUiState((prev) => {
      if (prev.isPanelFloating) {
        return { isRightPanelOpen: true, isSidebarOpen: false };
      }
      return { isRightPanelOpen: true };
    });
  };

  const updatePageTranslateOptions = (
    patch: Partial<EditorUiState["pageTranslateOptions"]>,
  ) => {
    onSetUiState((prev) => ({
      pageTranslateOptions: {
        ...prev.pageTranslateOptions,
        ...patch,
      },
    }));

    if (typeof patch.flattenFreetext === "boolean") {
      onSetAllFreetextFlatten(patch.flattenFreetext);
    }
  };

  if (rightPanelTab === "ai_chat") {
    return (
      <AiChatPanel
        isFloating={isPanelFloating}
        isOpen={isRightPanelOpen}
        onOpen={openPanel}
        width={rightPanelWidth}
        onResize={(width) => onSetUiState({ rightPanelWidth: width })}
        onCollapse={() => onSetUiState({ isRightPanelOpen: false })}
        aiChat={aiChat}
      />
    );
  }

  if (rightPanelTab === "page_translate") {
    return (
      <PageTranslatePanel
        isFloating={isPanelFloating}
        isOpen={isRightPanelOpen}
        onOpen={openPanel}
        width={rightPanelWidth}
        onResize={(width) => onSetUiState({ rightPanelWidth: width })}
        onCollapse={() => onSetUiState({ isRightPanelOpen: false })}
        totalPages={pagesLength}
        isProcessing={isPageTranslating}
        processingStatus={pageTranslateStatus}
        documentPermissions={documentPermissions}
        initialTranslateOption={translateOption}
        initialTargetLanguage={translateTargetLanguage || effectiveLanguage}
        options={pageTranslateOptions}
        onOptionsChange={updatePageTranslateOptions}
        paragraphCandidatesCount={pageTranslateParagraphCandidates.length}
        selectedParagraphCount={pageTranslateSelectedParagraphIds.length}
        onPreviewParagraphs={(opts) => {
          onPreviewParagraphs(opts);
        }}
        onClearParagraphs={onClearPageTranslateParagraphCandidates}
        onMergeSelectedParagraphs={onMergeSelectedPageTranslateParagraphs}
        onUnmergeSelectedParagraphs={() => {
          onUnmergeSelectedParagraphs();
        }}
        onToggleExcludeSelectedParagraphs={
          onToggleExcludeSelectedPageTranslateParagraphs
        }
        onDeleteSelectedParagraphs={onDeleteSelectedPageTranslateParagraphs}
        onStart={(opts) => {
          onStartPageTranslate(opts);
        }}
        onCancel={onCancelPageTranslate}
      />
    );
  }

  return (
    <PropertiesPanel
      selectedControl={selectedControl}
      activeTab={rightPanelTab === "properties" ? "properties" : "document"}
      metadata={metadata}
      filename={filename}
      onChange={onPropertiesChange}
      onMetadataChange={onMetadataChange}
      onFilenameChange={onFilenameChange}
      onDelete={onDeleteSelection}
      onClose={() => {
        onSetUiState({ rightPanelTab: "document" });
        onSelectControl(null);
      }}
      onCollapse={() => {
        onSetUiState({ isRightPanelOpen: false });
      }}
      isOpen={isRightPanelOpen}
      onOpen={openPanel}
      isFloating={isPanelFloating}
      onTriggerHistorySave={onSaveCheckpoint}
      width={rightPanelWidth}
      onResize={(width) => onSetUiState({ rightPanelWidth: width })}
    />
  );
}
