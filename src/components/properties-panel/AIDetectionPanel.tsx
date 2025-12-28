import React from "react";
import { Sparkles } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { PanelLayout } from "./PanelLayout";
import {
  AIDetectionOptions,
  AIDetectionOptionsForm,
} from "@/components/AIDetectionOptionsForm";
import { GEMINI_API_AVAILABLE } from "@/services/geminiService";

export interface AIDetectionPanelProps {
  isFloating: boolean;
  width: number;
  onResize: (width: number) => void;
  onCollapse: () => void;

  totalPages: number;
  isProcessing: boolean;

  onDetect: (options: AIDetectionOptions) => void;
}

export function AIDetectionPanel({
  isFloating,
  width,
  onResize,
  onCollapse,
  totalPages,
  isProcessing,
  onDetect,
}: AIDetectionPanelProps) {
  const { t } = useLanguage();

  return (
    <PanelLayout
      title={
        <>
          <Sparkles size={16} /> {t("ai_dialog.title")}
        </>
      }
      isFloating={isFloating}
      onClose={onCollapse}
      width={width}
      onResize={onResize}
      footer={
        <div className="space-y-2">
          {!GEMINI_API_AVAILABLE && (
            <div className="text-muted-foreground text-xs">
              {t("ai_panel.api_key_missing")}
            </div>
          )}

          <DialogFooter className="p-0">
            <Button
              disabled={!GEMINI_API_AVAILABLE || isProcessing}
              className="bg-purple-600 text-white hover:bg-purple-700"
              form="ai-detection-panel-form"
              type="submit"
            >
              <Sparkles size={16} className="mr-2" />
              {t("ai_dialog.start")}
            </Button>
          </DialogFooter>
        </div>
      }
    >
      <AIDetectionOptionsForm
        totalPages={totalPages}
        onSubmit={onDetect}
        renderFooter={({ isValid, onConfirm }) => (
          <form
            id="ai-detection-panel-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!isValid) return;
              onConfirm();
            }}
          />
        )}
      />
    </PanelLayout>
  );
}
