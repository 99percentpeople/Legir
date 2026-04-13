import { AiChatPanel } from "@/components/properties-panel/AiChatPanel";
import { PageTranslatePanel } from "@/components/properties-panel/PageTranslatePanel";
import { PropertiesPanel } from "@/components/properties-panel/PropertiesPanel";
import type {
  Annotation,
  EditorState,
  EditorUiState,
  FormField,
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

  if (rightPanelTab === "ai_chat") {
    return (
      <AiChatPanel
        isFloating={isPanelFloating}
        isOpen={isRightPanelOpen}
        onOpen={openPanel}
        width={rightPanelWidth}
        onResize={(width) => onSetUiState({ rightPanelWidth: width })}
        onCollapse={() => onSetUiState({ isRightPanelOpen: false })}
        sessions={aiChat.sessions}
        activeSessionId={aiChat.activeSessionId}
        onSelectSession={aiChat.selectSession}
        onNewConversation={aiChat.newConversation}
        onDeleteConversation={aiChat.deleteConversation}
        canDeleteConversation={aiChat.canDeleteConversation}
        timeline={aiChat.timeline}
        runStatus={aiChat.runStatus}
        lastError={aiChat.lastError}
        awaitingContinue={aiChat.awaitingContinue}
        isContextCompressionRunning={aiChat.isContextCompressionRunning}
        tokenUsage={aiChat.tokenUsage}
        contextTokens={aiChat.contextTokens}
        selectedModelKey={aiChat.selectedModelKey}
        onSelectModel={aiChat.setSelectedModelKey}
        modelGroups={aiChat.modelSelectGroups}
        onSend={(input) => {
          void aiChat.sendMessage(input);
        }}
        onContinueConversation={() => {
          void aiChat.continueConversation();
        }}
        onRegenerateMessage={(messageId) => {
          void aiChat.regenerateAssistantMessage(messageId);
        }}
        onRetryLastError={() => {
          void aiChat.retryLastFailedMessage();
        }}
        onEditUserMessage={aiChat.editUserMessage}
        onStop={aiChat.stop}
        onOpenDocumentLink={aiChat.openDocumentLink}
        disabledReason={aiChat.disabledReason}
        formToolsEnabled={aiChat.formToolsEnabled}
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
        initialTranslateOption={translateOption}
        initialTargetLanguage={translateTargetLanguage || effectiveLanguage}
        fontFamily={pageTranslateOptions.fontFamily}
        onFontFamilyChange={(value) =>
          onSetUiState((prev) => ({
            pageTranslateOptions: {
              ...prev.pageTranslateOptions,
              fontFamily: value,
            },
          }))
        }
        freetextPadding={pageTranslateOptions.freetextPadding}
        onFreetextPaddingChange={(value) =>
          onSetUiState((prev) => ({
            pageTranslateOptions: {
              ...prev.pageTranslateOptions,
              freetextPadding: value,
            },
          }))
        }
        usePositionAwarePrompt={pageTranslateOptions.usePositionAwarePrompt}
        onUsePositionAwarePromptChange={(value) =>
          onSetUiState((prev) => ({
            pageTranslateOptions: {
              ...prev.pageTranslateOptions,
              usePositionAwarePrompt: value,
            },
          }))
        }
        aiReflowParagraphs={pageTranslateOptions.aiReflowParagraphs}
        onAiReflowParagraphsChange={(value) =>
          onSetUiState((prev) => ({
            pageTranslateOptions: {
              ...prev.pageTranslateOptions,
              aiReflowParagraphs: value,
            },
          }))
        }
        contextWindow={pageTranslateOptions.contextWindow}
        onContextWindowChange={(value) =>
          onSetUiState((prev) => ({
            pageTranslateOptions: {
              ...prev.pageTranslateOptions,
              contextWindow: value,
            },
          }))
        }
        flattenAllFreetext={pageTranslateOptions.flattenFreetext}
        onFlattenAllFreetextChange={(value) => {
          onSetUiState((prev) => ({
            pageTranslateOptions: {
              ...prev.pageTranslateOptions,
              flattenFreetext: value,
            },
          }));
          onSetAllFreetextFlatten(value);
        }}
        useParagraphs={pageTranslateOptions.useParagraphs}
        onUseParagraphsChange={(value) =>
          onSetUiState((prev) => ({
            pageTranslateOptions: {
              ...prev.pageTranslateOptions,
              useParagraphs: value,
            },
          }))
        }
        paragraphXGap={pageTranslateOptions.paragraphXGap}
        onParagraphXGapChange={(value) =>
          onSetUiState((prev) => ({
            pageTranslateOptions: {
              ...prev.pageTranslateOptions,
              paragraphXGap: value,
            },
          }))
        }
        paragraphYGap={pageTranslateOptions.paragraphYGap}
        onParagraphYGapChange={(value) =>
          onSetUiState((prev) => ({
            pageTranslateOptions: {
              ...prev.pageTranslateOptions,
              paragraphYGap: value,
            },
          }))
        }
        paragraphSplitByFontSize={pageTranslateOptions.paragraphSplitByFontSize}
        onParagraphSplitByFontSizeChange={(value) =>
          onSetUiState((prev) => ({
            pageTranslateOptions: {
              ...prev.pageTranslateOptions,
              paragraphSplitByFontSize: value,
            },
          }))
        }
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
