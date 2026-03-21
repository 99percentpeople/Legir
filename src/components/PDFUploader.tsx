import React, { useCallback } from "react";
import { Upload, FileText } from "lucide-react";
import { Card, CardContent } from "./ui/card";
import { buttonVariants } from "./ui/button";
import { cn } from "@/utils/cn";
import { useLanguage } from "./language-provider";
import { canOpenWithPicker } from "@/services/platform";

interface PDFUploaderProps {
  onUpload: (file: File) => void;
  onOpen?: () => Promise<void>;
}

const PDFUploader: React.FC<PDFUploaderProps> = ({ onUpload, onOpen }) => {
  const { t } = useLanguage();
  const canUseOpenPicker = !!onOpen && canOpenWithPicker();
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files.length > 0 && files[0].type === "application/pdf") {
        onUpload(files[0]);
      }
    },
    [onUpload],
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files[0]);
    }
  };

  return (
    <div
      className="w-full"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <Card className="border-muted-foreground/25 hover:border-primary/50 bg-card/50 border-2 border-dashed shadow-sm backdrop-blur-sm transition-colors">
        <CardContent className="flex flex-col items-center p-12 text-center">
          <div className="bg-primary/10 text-primary animate-in zoom-in mb-6 flex h-20 w-20 items-center justify-center rounded-full duration-500">
            <FileText size={40} />
          </div>
          <h2 className="text-foreground mb-2 text-2xl font-bold">
            {t("uploader.title")}
          </h2>
          <p className="text-muted-foreground mb-8 max-w-md">
            {t("uploader.desc")}
          </p>

          {canUseOpenPicker ? (
            <button
              type="button"
              className={cn(
                buttonVariants({ size: "lg" }),
                "hover:shadow-primary/25 cursor-pointer shadow-lg transition-all",
              )}
              onClick={() => {
                void onOpen();
              }}
            >
              <Upload size={20} className="mr-2" />
              {t("uploader.btn")}
            </button>
          ) : (
            <label
              className={cn(
                buttonVariants({ size: "lg" }),
                "hover:shadow-primary/25 cursor-pointer shadow-lg transition-all",
              )}
            >
              <Upload size={20} className="mr-2" />
              {t("uploader.btn")}
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleFileInput}
              />
            </label>
          )}
        </CardContent>
      </Card>
      <p className="text-muted-foreground mt-4 text-center text-sm">
        {t("uploader.note")}
      </p>
    </div>
  );
};

export default PDFUploader;
