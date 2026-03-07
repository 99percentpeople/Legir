import React from "react";
import { Trash2, Image as ImageIcon, PenLine } from "lucide-react";
import { FormControlProps } from "../types";
import { ControlWrapper } from "../ControlWrapper";
import { cn } from "@/utils/cn";
import { useLanguage } from "@/components/language-provider";

export const SignatureControl: React.FC<FormControlProps> = (props) => {
  const { data, isFormMode, isAnnotationMode, isSelectable, onUpdate } = props;
  const { t } = useLanguage();
  const style = data.style || {};

  const effectiveBorderStyle =
    style.borderStyle === "dashed"
      ? "dashed"
      : style.borderStyle === "underline"
        ? "solid"
        : "solid";

  const containerStyle: React.CSSProperties = {
    backgroundColor: !style.isTransparent ? style.backgroundColor : undefined,
    borderWidth: `calc(${style.borderWidth}px * var(--scale, 1))`,
    borderColor: style.borderColor,
    borderStyle: effectiveBorderStyle,
    boxSizing: "border-box",
  };

  const showHelperBorder = (style.borderWidth ?? 1) === 0 && !props.isSelected;
  const showHelperBg = style.isTransparent && !props.isSelected;

  const handleInteraction = () => {
    if (isAnnotationMode) {
      // Open File Dialog
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            if (reader.result) {
              onUpdate(data.id, {
                signatureData: reader.result as string,
              });
            }
          };
          reader.readAsDataURL(file);
        }
      };
      input.click();
    }
  };

  return (
    <ControlWrapper
      {...props}
      showBorder={props.isSelected && isFormMode}
      resizable={true}
    >
      <div
        className={cn(
          "relative flex h-full w-full items-center justify-center overflow-hidden transition-colors",
          showHelperBg &&
            isFormMode &&
            cn(
              "bg-blue-500/10 dark:bg-blue-400/10",
              !isSelectable && "hover:bg-blue-500/20",
            ),
          isAnnotationMode && isSelectable && "hover:bg-black/5",
          isAnnotationMode && !isSelectable && "pointer-events-none",
          isFormMode && isSelectable && "pointer-events-none",
        )}
        style={containerStyle}
        onClick={handleInteraction}
      >
        {/* Helper Border Overlay */}
        {showHelperBorder && isFormMode && (
          <div
            className="pointer-events-none absolute inset-0 border border-dashed border-blue-400/50"
            style={{ zIndex: 1 }}
          />
        )}

        {data.signatureData ? (
          <>
            <img
              src={data.signatureData}
              alt="Signature"
              className={cn(
                "max-h-full max-w-full",
                data.imageScaleMode === "fill"
                  ? "h-full w-full object-fill"
                  : "object-contain",
              )}
            />
            {isAnnotationMode && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate(data.id, {
                    signatureData: undefined,
                  });
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 absolute top-1 right-1 z-20 rounded-sm p-1 opacity-0 shadow-md transition-opacity group-hover:opacity-100"
                title={t("common.delete")}
              >
                <Trash2 size={12} />
              </button>
            )}
          </>
        ) : (
          <div
            className={cn(
              "text-muted-foreground/50 flex flex-col items-center justify-center",
              isAnnotationMode ? "cursor-pointer" : "",
            )}
          >
            {isAnnotationMode ? <ImageIcon size={16} /> : <PenLine size={16} />}
            {isAnnotationMode && (
              <span className="text-[10px] opacity-70">Click to Sign</span>
            )}
          </div>
        )}
      </div>
    </ControlWrapper>
  );
};
