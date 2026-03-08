import React from "react";
import { Form, Sparkles } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { PanelLayout } from "./PanelLayout";
import {
  FormDetectionOptions,
  FormDetectionOptionsForm,
} from "@/components/FormDetectionOptionsForm";
import { isFormDetectAvailable } from "@/services/LLMService";

export interface FormDetectionPanelProps {
  isFloating: boolean;
  isOpen: boolean;
  onOpen: () => void;
  width: number;
  onResize: (width: number) => void;
  onCollapse: () => void;

  totalPages: number;
  isProcessing: boolean;

  onDetect: (options: FormDetectionOptions) => void;
}

export function FormDetectionPanel({
  isFloating,
  isOpen,
  onOpen,
  width,
  onResize,
  onCollapse,
  totalPages,
  isProcessing,
  onDetect,
}: FormDetectionPanelProps) {
  const { t } = useLanguage();
  const isAvailable = isFormDetectAvailable();

  return (
    <PanelLayout
      title={
        <>
          <Form size={16} /> {t("properties.form_detection.title")}
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
              {t("properties.form_detection.api_key_missing")}
            </div>
          )}

          <DialogFooter className="p-0">
            <Button
              disabled={!isAvailable || isProcessing}
              className="bg-purple-600 text-white hover:bg-purple-700"
              form="form-detection-panel-form"
              type="submit"
            >
              <Sparkles size={16} />
              {t("properties.form_detection.start")}
            </Button>
          </DialogFooter>
        </div>
      }
    >
      <FormDetectionOptionsForm
        totalPages={totalPages}
        onSubmit={onDetect}
        renderFooter={({ isValid, onConfirm }) => (
          <form
            id="form-detection-panel-form"
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
