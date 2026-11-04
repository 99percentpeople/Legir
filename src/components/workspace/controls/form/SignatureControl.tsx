import React from "react";
import { PenLine, ShieldQuestion } from "lucide-react";
import { canPreserveFormAppearance } from "@legir/pdf-model/formAppearance";
import type { FormControlProps } from "../types";
import { ControlWrapper } from "../ControlWrapper";
import { useLanguage } from "@/components/language-provider";

/** A PDF signature domain, not an image uploader or a certificate-validation badge. */
export const SignatureControl: React.FC<FormControlProps> = (props) => {
  const { data, isFormMode } = props;
  const { t } = useLanguage();
  const populated = !!data.signature?.present;
  const s = data.style ?? {};
  const appearance =
    populated || canPreserveFormAppearance(data)
      ? data.sourceAppearance
      : undefined;
  return (
    <ControlWrapper
      {...props}
      canModify={props.canModify !== false && !populated}
      resizable={!populated}
      showBorder={props.isSelected && isFormMode}
    >
      <div
        role="img"
        aria-label={`${data.name}: ${t(populated ? "properties.signature_present" : "properties.signature_empty")}`}
        className="pointer-events-none relative flex h-full w-full items-center justify-center overflow-hidden"
        title={t(
          populated
            ? "properties.signature_unverified"
            : "properties.signature_hint",
        )}
        style={
          appearance
            ? {}
            : {
                boxSizing: "border-box",
                backgroundColor: s.isTransparent
                  ? undefined
                  : s.backgroundColor,
                borderWidth: `calc(${s.borderWidth ?? 1}px * var(--scale, 1))`,
                borderColor: s.borderColor,
                borderStyle: s.borderStyle === "dashed" ? "dashed" : "solid",
                ...(s.borderStyle === "underline"
                  ? {
                      borderTopWidth: 0,
                      borderLeftWidth: 0,
                      borderRightWidth: 0,
                    }
                  : {}),
              }
        }
      >
        {appearance ? (
          <img
            src={appearance}
            alt={t(
              populated
                ? "properties.signature_present"
                : "properties.signature_empty",
            )}
            className="h-full w-full"
            draggable={false}
          />
        ) : (
          <div className="text-muted-foreground/60 flex flex-col items-center gap-1 overflow-hidden">
            {populated ? <ShieldQuestion size={18} /> : <PenLine size={18} />}
            <span className="text-[10px]">
              {t(
                populated
                  ? "properties.signature_present"
                  : "properties.signature_empty",
              )}
            </span>
          </div>
        )}
        {isFormMode && (s.borderWidth ?? 1) === 0 && !props.isSelected && (
          <div className="pointer-events-none absolute inset-0 border border-dashed border-blue-400/50" />
        )}
      </div>
    </ControlWrapper>
  );
};
