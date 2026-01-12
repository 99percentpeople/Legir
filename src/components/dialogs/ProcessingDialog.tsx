import React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { useLanguage } from "../language-provider";

type PdfLoadProgress = {
  id: string;
  label?: string;
  loaded: number;
  total?: number;
} | null;

interface ProcessingDialogProps {
  isOpen: boolean;
  processingStatus: string | null;
  pdfLoadProgress: PdfLoadProgress;
}

const ProcessingDialog: React.FC<ProcessingDialogProps> = ({
  isOpen,
  processingStatus,
  pdfLoadProgress,
}) => {
  const { t } = useLanguage();

  return (
    <Dialog open={isOpen}>
      <DialogContent
        showCloseButton={false}
        className="flex flex-col items-center justify-center text-center sm:max-w-[300px]"
      >
        <DialogTitle className="sr-only">{t("common.processing")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("common.processing")}
        </DialogDescription>

        <Spinner size="lg" className="text-primary mb-4" />

        <p className="text-foreground text-lg font-medium">
          {processingStatus || t("common.processing")}
        </p>

        {pdfLoadProgress && (
          <div className="mt-4 w-full">
            <div className="text-muted-foreground mb-2 text-xs">
              {(() => {
                const total = pdfLoadProgress.total;
                const loaded = pdfLoadProgress.loaded;
                if (typeof total === "number" && total > 0) {
                  const pct = Math.max(
                    0,
                    Math.min(100, Math.round((loaded / total) * 100)),
                  );
                  return `${pct}%`;
                }
                return `${Math.max(0, loaded)} bytes`;
              })()}
            </div>
            <div className="bg-muted h-2 w-full rounded">
              <div
                className="bg-primary h-2 rounded"
                style={{
                  width:
                    typeof pdfLoadProgress.total === "number" &&
                    pdfLoadProgress.total > 0
                      ? `${Math.max(
                          0,
                          Math.min(
                            100,
                            (pdfLoadProgress.loaded / pdfLoadProgress.total) *
                              100,
                          ),
                        )}%`
                      : "25%",
                }}
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ProcessingDialog;
