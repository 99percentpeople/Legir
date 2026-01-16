import React, { useCallback, useMemo } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { AnnotationControlProps } from "../types";
import { ControlWrapper } from "../ControlWrapper";
import { appEventBus } from "@/lib/eventBus";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLanguage } from "@/components/language-provider";

export const LinkControl: React.FC<AnnotationControlProps> = (props) => {
  const { data } = props;
  const { t } = useLanguage();

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

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (destPageIndex !== null) {
        event.preventDefault();
        appEventBus.emit("workspace:navigatePage", {
          pageIndex: destPageIndex,
          behavior: "smooth",
        });
        return;
      }

      if (!safeUrl) return;

      if (isTauri()) {
        event.preventDefault();
        void openUrl(safeUrl);
      }
    },
    [destPageIndex, safeUrl, appEventBus, isTauri, openUrl],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLAnchorElement>) => {
      event.stopPropagation();
    },
    [],
  );

  if (!safeUrl && destPageIndex === null) return null;

  return (
    <ControlWrapper {...props} showBorder={false}>
      <a
        className="absolute inset-0"
        href={safeUrl || "#"}
        target={safeUrl ? "_blank" : undefined}
        rel={safeUrl ? "noopener noreferrer" : undefined}
        title={title}
        aria-label={title}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        style={{ cursor: "pointer" }}
      />
    </ControlWrapper>
  );
};
