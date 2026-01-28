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
import { isAIDetectAvailable } from "@/services/LLMService";

export interface AIDetectionPanelProps {
  isFloating: boolean;
  isOpen: boolean;
  onOpen: () => void;
  width: number;
  onResize: (width: number) => void;
  onCollapse: () => void;

  totalPages: number;
  isProcessing: boolean;

  onDetect: (options: AIDetectionOptions) => void;
}

export function AIDetectionPanel({
  isFloating,
  isOpen,
  onOpen,
  width,
  onResize,
  onCollapse,
  totalPages,
  isProcessing,
  onDetect,
}: AIDetectionPanelProps) {
  const { t } = useLanguage();
  const isAvailable = isAIDetectAvailable();

  return (
    <PanelLayout
      title={
        <>
          <Sparkles size={16} /> {t("properties.ai_detection.title")}
        </>
      }
      isFloating={isFloating}
      isOpen={isOpen}
      onOpen={onOpen}
      onCollapse={onCollapse}
      onClose={onCollapse}
      width={width}
      onResize={onResize}
      footer={
        <div className="space-y-2">
          {!isAvailable && (
            <div className="text-muted-foreground text-xs">
              {t("properties.ai_detection.api_key_missing")}
            </div>
          )}

          <DialogFooter className="p-0">
            <Button
              disabled={!isAvailable || isProcessing}
              className="bg-purple-600 text-white hover:bg-purple-700"
              form="ai-detection-panel-form"
              type="submit"
            >
              <Sparkles size={16} className="mr-2" />
              {t("properties.ai_detection.start")}
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
