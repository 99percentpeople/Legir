import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TranslateFn } from "./types";

interface EditorCloseConfirmDialogProps {
  open: boolean;
  isDirty: boolean;
  documentTitle?: string | null;
  platformDocumentSaveMode: "draft" | "file";
  onCloseDialog: () => void;
  onSaveAndClose: () => Promise<void>;
  onCloseWithoutSaving: () => Promise<void>;
  t: TranslateFn;
}

export function EditorCloseConfirmDialog({
  open,
  isDirty,
  documentTitle,
  platformDocumentSaveMode,
  onCloseDialog,
  onSaveAndClose,
  onCloseWithoutSaving,
  t,
}: EditorCloseConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCloseDialog();
      }}
    >
      <DialogContent>
        <DialogTitle>{t("dialog.confirm_close.title")}</DialogTitle>
        <DialogDescription>
          {documentTitle
            ? t("dialog.confirm_close.desc_named", { filename: documentTitle })
            : t("dialog.confirm_close.desc")}
        </DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={onCloseDialog}>
            {t("dialog.confirm_close.cancel")}
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              if (!isDirty) return;
              await onSaveAndClose();
            }}
          >
            {platformDocumentSaveMode === "file"
              ? t("dialog.confirm_close.save_close")
              : t("dialog.confirm_close.save_draft_close")}
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              await onCloseWithoutSaving();
            }}
          >
            {t("dialog.confirm_close.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
