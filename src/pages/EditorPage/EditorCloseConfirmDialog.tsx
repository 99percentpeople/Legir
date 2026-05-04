import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

interface EditorCloseConfirmDialogProps {
  open: boolean;
  isDirty: boolean;
  documentTitle?: string | null;
  onCloseDialog: () => void;
  onSaveAndClose: () => Promise<void>;
  onCloseWithoutSaving: () => Promise<void>;
}

export function EditorCloseConfirmDialog({
  open,
  isDirty,
  documentTitle,
  onCloseDialog,
  onSaveAndClose,
  onCloseWithoutSaving,
}: EditorCloseConfirmDialogProps) {
  const { t } = useLanguage();

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
            {t("dialog.confirm_close.save_close")}
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
