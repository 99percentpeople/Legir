import React from "react";
import {
  ChevronDown,
  Download,
  FileText,
  Printer,
  Save,
  SaveAll,
  XCircle,
} from "lucide-react";

import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Separator } from "../ui/separator";
import { useLanguage } from "../language-provider";
import { ButtonGroup } from "../ui/button-group";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePlatformUi } from "@/services/platform";
import { useAppEvent } from "@/hooks/useAppEventBus";

export interface ExportMenuProps {
  disabled: boolean;
  isDirty: boolean;
  hasSaveAs: boolean;
  onPrimary: () => Promise<boolean>;
  onSaveDraft: (silent?: boolean) => Promise<void>;
  onSaveAs: () => Promise<boolean>;
  onExit: () => void;
  onPrint: () => void;
  onClose: () => void;
}

const ExportMenu: React.FC<ExportMenuProps> = ({
  disabled,
  isDirty,
  hasSaveAs,
  onPrimary,
  onSaveDraft,
  onSaveAs,
  onExit,
  onPrint,
  onClose,
}) => {
  const { t } = useLanguage();
  const { documentSaveMode } = usePlatformUi();
  const [open, setOpen] = React.useState(false);
  const isFileSaveMode = documentSaveMode === "file";

  const saveDisabled = disabled || (isFileSaveMode && !isDirty);
  const primaryLabel = t(
    isFileSaveMode ? "common.actions.save" : "toolbar.export",
  );
  const PrimaryIcon = isFileSaveMode ? Save : Download;

  const isMobile = useIsMobile();

  useAppEvent("workspace:pointerDown", () => {
    setOpen(false);
  });

  const handleSaveAndExit = async (save: () => Promise<boolean>) => {
    const ok = await save();
    if (!ok) return;

    if (!isFileSaveMode) {
      await onSaveDraft(false);
    }
    onExit();
  };

  return (
    <ButtonGroup>
      {!isMobile && (
        <Button
          onClick={onPrimary}
          disabled={saveDisabled}
          className="hidden rounded-r-none sm:flex"
        >
          <PrimaryIcon size={16} />
          <span className="hidden sm:inline">{primaryLabel}</span>
        </Button>
      )}

      <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button size="icon" disabled={disabled}>
            <PrimaryIcon size={16} className="sm:hidden" />
            <ChevronDown size={16} className="hidden sm:block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-56"
          data-ff-block-modifier-wheel-zoom="1"
        >
          <DropdownMenuItem
            onClick={onPrimary}
            className="sm:hidden"
            disabled={saveDisabled}
          >
            <PrimaryIcon size={16} />
            {primaryLabel}
          </DropdownMenuItem>
          <Separator className="my-1 sm:hidden" />

          {!isFileSaveMode && (
            <DropdownMenuItem
              onClick={() => {
                void onSaveDraft(false);
              }}
            >
              <Save size={16} />
              {t("toolbar.save_draft")}
            </DropdownMenuItem>
          )}
          {hasSaveAs && (
            <DropdownMenuItem onClick={onSaveAs}>
              <SaveAll size={16} />
              {t("toolbar.save_as")}
            </DropdownMenuItem>
          )}

          <Separator className="my-1" />

          <DropdownMenuItem
            onClick={() => {
              void handleSaveAndExit(onPrimary);
            }}
            disabled={saveDisabled}
          >
            <FileText size={16} />
            {t(isFileSaveMode ? "toolbar.save_close" : "toolbar.export_close")}
          </DropdownMenuItem>
          {hasSaveAs && (
            <DropdownMenuItem
              onClick={() => {
                void handleSaveAndExit(onSaveAs);
              }}
            >
              <FileText size={16} />
              {t("toolbar.save_as_close")}
            </DropdownMenuItem>
          )}

          <Separator className="my-1" />

          <DropdownMenuItem onClick={onPrint}>
            <Printer size={16} />
            {t("toolbar.print")}
          </DropdownMenuItem>

          <DropdownMenuItem onClick={onClose} variant="destructive">
            <XCircle size={16} />
            {t("toolbar.close")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
};

export default ExportMenu;
