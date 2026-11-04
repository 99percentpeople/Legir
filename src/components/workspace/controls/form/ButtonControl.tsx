import React from "react";
import { Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { canPreserveFormAppearance } from "@legir/pdf-model/formAppearance";
import { resolveFormControlFontFamilyCss } from "@legir/pdf-model/fonts";
import type { FormControlProps } from "../types";
import { ControlWrapper } from "../ControlWrapper";
import { useLanguage } from "@/components/language-provider";
import { cn } from "@/utils/cn";
import { readButtonImageFile } from "./buttonImageFile";

export const ButtonControl: React.FC<FormControlProps> = (props) => {
  const { data, isFormMode, isAnnotationMode, isSelectable, onUpdate } = props;
  const { t } = useLanguage();
  const input = React.useRef<HTMLInputElement>(null);
  const active = React.useRef(true);
  React.useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const layout = data.buttonLayout ?? 0;
  const canUpload =
    isAnnotationMode &&
    isSelectable &&
    props.canFillFormValue !== false &&
    !data.readOnly &&
    layout !== 0;
  const image =
    data.buttonImage === null
      ? undefined
      : (data.buttonImage ?? data.buttonIconPreview);
  const appearance = canPreserveFormAppearance(data)
    ? data.sourceAppearance
    : undefined;
  const s = data.style ?? {};
  const fit = data.buttonImageFit;
  const containerStyle: React.CSSProperties = appearance
    ? {}
    : {
        boxSizing: "border-box",
        backgroundColor: s.isTransparent ? undefined : s.backgroundColor,
        borderColor: s.borderColor,
        borderWidth: `calc(${s.borderWidth ?? 1}px * var(--scale, 1))`,
        borderStyle: s.borderStyle === "dashed" ? "dashed" : "solid",
        ...(s.borderStyle === "underline"
          ? { borderTopWidth: 0, borderLeftWidth: 0, borderRightWidth: 0 }
          : {}),
        color: s.textColor,
        fontSize: `calc(${s.fontSize ?? 12}px * var(--scale, 1))`,
        fontFamily: resolveFormControlFontFamilyCss(
          s.fontFamily,
          data.buttonCaption,
        ),
      };
  const upload = async (file: File | undefined) => {
    if (!file || !canUpload) return;
    try {
      const buttonImage = await readButtonImageFile(file);
      if (!active.current) return;
      props.onTriggerHistorySave?.();
      onUpdate(data.id, { buttonImage });
    } catch {
      if (active.current) toast.error(t("properties.button_image_error"));
    }
  };
  const icon = layout !== 0 && (
    <div
      className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden"
      style={layout === 6 ? { position: "absolute", inset: 0 } : undefined}
    >
      {image ? (
        <img
          src={image}
          alt={data.toolTip || data.name}
          className="h-full w-full"
          draggable={false}
          style={{
            objectFit:
              fit?.scaleMode === "fill"
                ? "fill"
                : fit?.when === "never"
                  ? "none"
                  : fit?.when === "bigger"
                    ? "scale-down"
                    : "contain",
            objectPosition: `${(fit?.alignment[0] ?? 0.5) * 100}% ${(1 - (fit?.alignment[1] ?? 0.5)) * 100}%`,
          }}
        />
      ) : (
        <ImageIcon className="text-muted-foreground/60" size={18} />
      )}
    </div>
  );
  const caption = layout !== 1 && (
    <span
      className="relative shrink-0 overflow-hidden text-center whitespace-nowrap"
      style={{
        maxWidth: "100%",
        ...(layout === 6 ? { margin: "auto", zIndex: 1 } : {}),
      }}
    >
      {data.buttonCaption ?? ""}
    </span>
  );
  return (
    <ControlWrapper
      {...props}
      showBorder={props.isSelected && isFormMode}
      resizable
    >
      <div
        role="button"
        aria-label={data.toolTip || data.name}
        aria-disabled={!canUpload}
        tabIndex={canUpload ? 0 : -1}
        className={cn(
          "relative flex h-full w-full overflow-hidden",
          canUpload && "cursor-pointer",
          isFormMode && "pointer-events-none",
          !isSelectable && "pointer-events-none",
        )}
        style={containerStyle}
        onClick={() => {
          if (canUpload) input.current?.click();
        }}
        onKeyDown={(event) => {
          if (canUpload && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            input.current?.click();
          }
        }}
        title={
          canUpload
            ? t("properties.button_upload")
            : t("properties.button_actions_note")
        }
      >
        {appearance ? (
          <img
            src={appearance}
            alt={data.buttonCaption || data.name}
            className="h-full w-full"
            draggable={false}
          />
        ) : (
          <div
            className="relative flex h-full w-full items-center justify-center gap-px overflow-hidden"
            style={{
              padding: `calc(1px * var(--scale, 1))`,
              flexDirection:
                layout === 2
                  ? "column"
                  : layout === 3
                    ? "column-reverse"
                    : layout === 5
                      ? "row-reverse"
                      : "row",
            }}
          >
            {icon}
            {caption}
          </div>
        )}
        {isFormMode && (s.borderWidth ?? 1) === 0 && !props.isSelected && (
          <div className="pointer-events-none absolute inset-0 border border-dashed border-blue-400/50" />
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        aria-label={t("properties.button_upload")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void upload(file);
        }}
      />
    </ControlWrapper>
  );
};
