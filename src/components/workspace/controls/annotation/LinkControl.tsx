import React, { useCallback, useMemo } from "react";
import { AnnotationControlProps } from "../types";
import { ControlWrapper } from "../ControlWrapper";
import { appEventBus } from "@/lib/eventBus";
import { useLanguage } from "@/components/language-provider";
import { useEditorStore } from "@/store/useEditorStore";
import { openExternalUrl } from "@/services/platform";

const getSafeUrl = (raw: string) => {
  try {
    const base =
      typeof window !== "undefined" ? window.location.href : "about:blank";
    const url = new URL(raw, base);
    const protocol = url.protocol.toLowerCase();
    if (
      protocol === "http:" ||
      protocol === "https:" ||
      protocol === "mailto:" ||
      protocol === "tel:"
    ) {
      return url.href;
    }
  } catch {
    // ignore
  }
  return null;
};

export const LinkControl: React.FC<AnnotationControlProps> = (props) => {
  const { data, id, isSelected, onSelect } = props;
  const { t } = useLanguage();
  const isModifierPressed = useEditorStore(
    (state) => state.keys.ctrl || state.keys.meta,
  );

  const safeUrl = useMemo(() => {
    if (!data.linkUrl) return null;
    return getSafeUrl(data.linkUrl);
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
      event?.preventDefault();
      void openExternalUrl(safeUrl);
    },
    [destPageIndex, safeUrl, id, onSelect, isModifierPressed, appEventBus],
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
