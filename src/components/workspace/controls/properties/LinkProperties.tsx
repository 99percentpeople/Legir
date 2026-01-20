import React from "react";
import { Annotation } from "@/types";
import { PropertyPanelProps } from "./types";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/components/language-provider";
import { Link2 } from "lucide-react";

export const LinkProperties: React.FC<PropertyPanelProps<Annotation>> = ({
  data,
}) => {
  const { t } = useLanguage();
  const dest =
    typeof data.linkDestPageIndex === "number"
      ? t("properties.link.page", { page: data.linkDestPageIndex + 1 })
      : t("properties.link.not_available");
  const url = data.linkUrl || t("properties.link.not_available");

  return (
    <div>
      <h4 className="text-muted-foreground mb-3 flex items-center text-xs font-semibold tracking-wider uppercase">
        <Link2 size={12} className="mr-1.5" />
        {t("properties.link.title")}
      </h4>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>{t("properties.link.url")}</Label>
          <div className="text-muted-foreground text-sm break-all">{url}</div>
        </div>
        <div className="space-y-2">
          <Label>{t("properties.link.destination")}</Label>
          <div className="text-muted-foreground text-sm">{dest}</div>
        </div>
      </div>
    </div>
  );
};
