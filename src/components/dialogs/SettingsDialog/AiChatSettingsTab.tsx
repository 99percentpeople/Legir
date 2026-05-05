import { useLanguage } from "@/components/language-provider";
import { ModelSelect, type ModelSelectGroup } from "@/components/ModelSelect";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import {
  AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_MAX,
  AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_MIN,
  AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_STEP,
  AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MAX,
  AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MIN,
  AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_STEP,
  AI_CHAT_MAX_TOOL_ROUNDS_MAX,
  AI_CHAT_MAX_TOOL_ROUNDS_MIN,
  AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MAX,
  AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MIN,
} from "@/constants";
import type { AiChatOptions } from "@/types";

import { SETTINGS_CARD_SPACIOUS_CLASS } from "./styles";
import type { UpdateAiChatOptions } from "./types";

interface AiChatSettingsTabProps {
  options: AiChatOptions;
  aiToolModelGroups: ModelSelectGroup[];
  aiVisionModelGroups: ModelSelectGroup[];
  updateAiChatOptions: UpdateAiChatOptions;
}

export const AiChatSettingsTab = ({
  options,
  aiToolModelGroups,
  aiVisionModelGroups,
  updateAiChatOptions,
}: AiChatSettingsTabProps) => {
  const { t } = useLanguage();
  const visualSummaryEnabled = options.visualSummaryEnabled;
  const contextCompressionEnabled = options.contextCompressionEnabled;
  const visualHistoryWindow = options.visualHistoryWindow;
  const contextCompressionThresholdTokens =
    options.contextCompressionThresholdTokens;
  const maxToolRounds = options.maxToolRounds;
  const getPagesTextMaxChars = options.getPagesTextMaxChars;
  const contextCompressionMode = options.contextCompressionMode;
  const contextCompressionModelKey = options.contextCompressionModelKey;

  return (
    <TabsContent value="ai_chat">
      <div className="space-y-6">
        <div className={SETTINGS_CARD_SPACIOUS_CLASS}>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label
                htmlFor="ai-chat-max-tool-rounds"
                className="font-semibold"
              >
                {t("settings.ai_chat.max_tool_rounds")}
              </Label>
              <span className="text-muted-foreground text-xs">
                {maxToolRounds}
              </span>
            </div>
            <Slider
              value={[maxToolRounds]}
              min={AI_CHAT_MAX_TOOL_ROUNDS_MIN}
              max={AI_CHAT_MAX_TOOL_ROUNDS_MAX}
              step={1}
              onValueChange={(values) => {
                const next = values[0];
                if (!Number.isFinite(next)) return;
                updateAiChatOptions({ maxToolRounds: next });
              }}
            />
            <div className="text-muted-foreground flex justify-between text-xs">
              <span>{AI_CHAT_MAX_TOOL_ROUNDS_MIN}</span>
              <span>{AI_CHAT_MAX_TOOL_ROUNDS_MAX}</span>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <Label
                  htmlFor="ai-chat-get-pages-text-max-chars"
                  className="font-semibold"
                >
                  {t("settings.ai_chat.get_pages_text_max_chars")}
                </Label>
                <p className="text-muted-foreground text-xs">
                  {t("settings.ai_chat.get_pages_text_max_chars_desc")}
                </p>
              </div>
              <span className="text-muted-foreground shrink-0 text-xs">
                {getPagesTextMaxChars.toLocaleString()}
              </span>
            </div>
            <Slider
              id="ai-chat-get-pages-text-max-chars"
              value={[getPagesTextMaxChars]}
              min={AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MIN}
              max={AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MAX}
              step={AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_STEP}
              onValueChange={(values) => {
                const next = values[0];
                if (!Number.isFinite(next)) return;
                updateAiChatOptions({ getPagesTextMaxChars: next });
              }}
            />
            <div className="text-muted-foreground flex justify-between text-xs">
              <span>
                {AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MIN.toLocaleString()}
              </span>
              <span>
                {AI_CHAT_GET_PAGES_TEXT_MAX_CHARS_MAX.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        <div className={SETTINGS_CARD_SPACIOUS_CLASS}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label
                htmlFor="ai-chat-context-pruning-enabled"
                className="font-semibold"
              >
                {t("settings.ai_chat.context_pruning_enabled")}
              </Label>
              <p className="text-muted-foreground text-xs">
                {t("settings.ai_chat.context_pruning_enabled_desc")}
              </p>
            </div>
            <Switch
              id="ai-chat-context-pruning-enabled"
              checked={contextCompressionEnabled}
              onCheckedChange={(checked) =>
                updateAiChatOptions({ contextCompressionEnabled: checked })
              }
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="ai-chat-context-pruning-threshold">
                {t("settings.ai_chat.context_pruning_trigger_context_tokens")}
              </Label>
              <span className="text-muted-foreground text-xs">
                {contextCompressionThresholdTokens.toLocaleString()}
              </span>
            </div>
            <Slider
              value={[contextCompressionThresholdTokens]}
              disabled={!contextCompressionEnabled}
              min={AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_MIN}
              max={AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_MAX}
              step={AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_STEP}
              onValueChange={(values) => {
                const next = values[0];
                if (!Number.isFinite(next)) return;
                updateAiChatOptions({
                  contextCompressionThresholdTokens: next,
                });
              }}
            />
            <div className="text-muted-foreground flex justify-between text-xs">
              <span>
                {AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_MIN.toLocaleString()}
              </span>
              <span>
                {AI_CHAT_CONTEXT_PRUNING_TRIGGER_CONTEXT_TOKENS_MAX.toLocaleString()}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              {t(
                "settings.ai_chat.context_pruning_trigger_context_tokens_desc",
              )}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="ai-chat-visual-tool-history-window">
                {t("settings.ai_chat.visual_tool_history_window")}
              </Label>
              <span className="text-muted-foreground text-xs">
                {visualHistoryWindow}
              </span>
            </div>
            <Slider
              value={[visualHistoryWindow]}
              min={AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MIN}
              max={AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MAX}
              step={1}
              onValueChange={(values) => {
                const next = values[0];
                if (!Number.isFinite(next)) return;
                updateAiChatOptions({ visualHistoryWindow: next });
              }}
            />
            <div className="text-muted-foreground flex justify-between text-xs">
              <span>{AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MIN}</span>
              <span>{AI_CHAT_VISUAL_TOOL_HISTORY_WINDOW_MAX}</span>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="font-semibold">
              {t("settings.ai_chat.context_compression_mode")}
            </Label>
            <Select
              value={contextCompressionMode}
              disabled={!contextCompressionEnabled}
              onValueChange={(value) => {
                if (value !== "algorithmic" && value !== "ai") return;
                updateAiChatOptions({ contextCompressionMode: value });
              }}
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue
                  placeholder={t("settings.ai_chat.context_compression_mode")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="algorithmic">
                  {t("settings.ai_chat.context_compression_mode_algorithmic")}
                </SelectItem>
                <SelectItem value="ai">
                  {t("settings.ai_chat.context_compression_mode_ai")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {t("settings.ai_chat.context_compression_mode_desc")}
            </p>
          </div>

          {contextCompressionMode === "ai" ? (
            <div className="space-y-2">
              <Label className="font-semibold">
                {t("settings.ai_chat.context_compression_model")}
              </Label>
              <ModelSelect
                value={contextCompressionModelKey || undefined}
                onValueChange={(value) =>
                  updateAiChatOptions({ contextCompressionModelKey: value })
                }
                placeholder={
                  aiToolModelGroups.length > 0
                    ? t(
                        "settings.ai_chat.context_compression_model_placeholder",
                      )
                    : t("settings.ai_chat.no_models")
                }
                groups={aiToolModelGroups}
                disabled={
                  !contextCompressionEnabled || aiToolModelGroups.length === 0
                }
                showSeparators
              />
              <p className="text-muted-foreground text-xs">
                {t("settings.ai_chat.context_compression_model_desc")}
              </p>
            </div>
          ) : null}

          <p className="text-muted-foreground text-xs">
            {t("settings.ai_chat.context_pruning_desc")}
          </p>
        </div>

        <div className={SETTINGS_CARD_SPACIOUS_CLASS}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label
                htmlFor="ai-chat-form-tools-enabled"
                className="font-semibold"
              >
                {t("settings.ai_chat.form_tools_enabled")}
              </Label>
              <p className="text-muted-foreground text-xs">
                {t("settings.ai_chat.form_tools_enabled_desc")}
              </p>
            </div>
            <Switch
              id="ai-chat-form-tools-enabled"
              checked={options.formToolsEnabled}
              onCheckedChange={(checked) =>
                updateAiChatOptions({ formToolsEnabled: checked })
              }
            />
          </div>

          <Separator />

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label
                htmlFor="ai-chat-detect-form-fields-enabled"
                className="font-semibold"
              >
                {t("settings.ai_chat.detect_form_fields_enabled")}
              </Label>
              <p className="text-muted-foreground text-xs">
                {t("settings.ai_chat.detect_form_fields_enabled_desc")}
              </p>
            </div>
            <Switch
              id="ai-chat-detect-form-fields-enabled"
              checked={options.detectFormFieldsEnabled}
              onCheckedChange={(checked) =>
                updateAiChatOptions({ detectFormFieldsEnabled: checked })
              }
              disabled={!options.formToolsEnabled}
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="font-semibold">
              {t("settings.ai_chat.form_tools_vision_model")}
            </Label>
            <ModelSelect
              value={options.formToolsVisionModelKey || undefined}
              onValueChange={(value) =>
                updateAiChatOptions({ formToolsVisionModelKey: value })
              }
              placeholder={
                aiVisionModelGroups.length > 0
                  ? t("settings.ai_chat.form_tools_vision_model_placeholder")
                  : t("settings.ai_chat.no_models")
              }
              groups={aiVisionModelGroups}
              disabled={
                !options.formToolsEnabled ||
                !options.detectFormFieldsEnabled ||
                aiVisionModelGroups.length === 0
              }
              showSeparators
            />
            <p className="text-muted-foreground text-xs">
              {t("settings.ai_chat.form_tools_vision_model_desc")}
            </p>
          </div>
        </div>

        <div className={SETTINGS_CARD_SPACIOUS_CLASS}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label
                htmlFor="ai-chat-visual-summary-enabled"
                className="font-semibold"
              >
                {t("settings.ai_chat.visual_summary_enabled")}
              </Label>
              <p className="text-muted-foreground text-xs">
                {t("settings.ai_chat.visual_summary_enabled_desc")}
              </p>
            </div>
            <Switch
              id="ai-chat-visual-summary-enabled"
              checked={visualSummaryEnabled}
              onCheckedChange={(checked) =>
                updateAiChatOptions({ visualSummaryEnabled: checked })
              }
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="font-semibold">
              {t("settings.ai_chat.visual_summary_model")}
            </Label>
            <ModelSelect
              value={options.visualSummaryModelKey || undefined}
              onValueChange={(value) =>
                updateAiChatOptions({ visualSummaryModelKey: value })
              }
              placeholder={
                aiVisionModelGroups.length > 0
                  ? t("settings.ai_chat.visual_summary_model_placeholder")
                  : t("settings.ai_chat.no_models")
              }
              groups={aiVisionModelGroups}
              disabled={
                !visualSummaryEnabled || aiVisionModelGroups.length === 0
              }
              showSeparators
            />
            <p className="text-muted-foreground text-xs">
              {t("settings.ai_chat.visual_summary_model_desc")}
            </p>
          </div>
        </div>
      </div>
    </TabsContent>
  );
};
