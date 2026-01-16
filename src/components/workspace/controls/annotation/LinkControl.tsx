import React, { useCallback, useMemo } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { AnnotationControlProps } from "../types";
import { ControlWrapper } from "../ControlWrapper";
import { appEventBus } from "@/lib/eventBus";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLanguage } from "@/components/language-provider";
import { useEditorStore } from "@/store/useEditorStore";

export const LinkControl: React.FC<AnnotationControlProps> = (props) => {
  const { data, id, isSelected, onSelect } = props;
  const { t } = useLanguage();
  const isModifierPressed = useEditorStore(
    (state) => state.keys.ctrl || state.keys.meta,
  );

  const safeUrl = useMemo(() => {
    if (!data.linkUrl) return null;
    try {
      const url = pdfjsLib.createValidAbsoluteUrl(data.linkUrl);
      return url ? url.href : null;
    } catch {
      return null;
    }
  }, [data.linkUrl]);

  const destPageIndex =
    typeof data.linkDestPageIndex === "number" ? data.linkDestPageIndex : null;

  const title = safeUrl
    ? safeUrl
    : destPageIndex !== null
      ? t("properties.link.go_to_page", { page: destPageIndex + 1 })
      : t("properties.link.title");

  const handleActivate = useCallback(
    (event?: React.SyntheticEvent) => {
      if (isModifierPressed) {
        event?.preventDefault();
        event?.stopPropagation();
        onSelect(id);
        return;
      }

      if (destPageIndex !== null) {
        event?.preventDefault();
        appEventBus.emit("workspace:navigatePage", {
          pageIndex: destPageIndex,
          behavior: "smooth",
        });
        return;
      }

      if (!safeUrl) return;

      if (isTauri()) {
        event?.preventDefault();
        void openUrl(safeUrl);
        return;
      }

      if (typeof window !== "undefined") {
        window.open(safeUrl, "_blank", "noopener,noreferrer");
      }
    },
    [
      destPageIndex,
      safeUrl,
      id,
      onSelect,
      isModifierPressed,
      appEventBus,
      isTauri,
      openUrl,
    ],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      handleActivate(event);
    },
    [handleActivate],
  );

  if (!safeUrl && destPageIndex === null) return null;

  return (
    <ControlWrapper {...props} showBorder={isSelected}>
      <a
        className="absolute inset-0"
        role="link"
        tabIndex={0}
        title={title}
        aria-label={title}
        href={safeUrl || undefined}
        target={safeUrl ? "_blank" : undefined}
        rel={safeUrl ? "noopener noreferrer" : undefined}
        onClick={handleClick}
        style={{ cursor: "pointer" }}
      />
    </ControlWrapper>
  );
};
