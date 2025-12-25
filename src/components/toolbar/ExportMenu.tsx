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

import { isTauri } from "@tauri-apps/api/core";

import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Separator } from "../ui/separator";
import { useLanguage } from "../language-provider";

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
  const tauri = isTauri();

  const saveDisabled = disabled || (tauri && !isDirty);

  const primaryLabel = tauri ? t("common.save") : t("toolbar.export");
  const PrimaryIcon = tauri ? Save : Download;

  return (
    <div className="isolate flex rounded-md shadow-sm">
      <Button
        onClick={onPrimary}
        disabled={saveDisabled}
        className="hidden rounded-r-none sm:flex"
      >
        <PrimaryIcon size={16} />
        <span className="hidden sm:inline">{primaryLabel}</span>
      </Button>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            disabled={disabled}
            className="border-l-border -ml-px h-8 w-8 rounded-l-md border-l-0 p-0 sm:h-9 sm:w-auto sm:rounded-l-none sm:border-l sm:px-2"
          >
            <PrimaryIcon size={16} className="sm:hidden" />
            <ChevronDown size={16} className="hidden sm:block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            onClick={onPrimary}
            className="sm:hidden"
            disabled={saveDisabled}
          >
            <PrimaryIcon size={16} />
            {primaryLabel}
          </DropdownMenuItem>
          <Separator className="my-1 sm:hidden" />

          {!tauri && (
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
            onClick={async () => {
              const ok = await onPrimary();
              if (!ok) return;

              if (!tauri) {
                await onSaveDraft(false);
              }
              onExit();
            }}
            disabled={saveDisabled}
          >
            <FileText size={16} />
            {t("toolbar.save_close")}
          </DropdownMenuItem>
          {hasSaveAs && (
            <DropdownMenuItem
              onClick={async () => {
                const ok = await onSaveAs();
                if (!ok) return;

                if (!tauri) {
                  await onSaveDraft(false);
                }
                onExit();
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
    </div>
  );
};

export default ExportMenu;
