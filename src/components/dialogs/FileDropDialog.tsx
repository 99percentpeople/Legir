import React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { useLanguage } from "../language-provider";

interface FileDropDialogProps {
  isOpen: boolean;
  pendingPath: string | null;
  isDirty: boolean;
  onClose: () => void;
  onSaveAndOpen: () => void | Promise<void>;
  onOpen: () => void | Promise<void>;
}

const FileDropDialog: React.FC<FileDropDialogProps> = ({
  isOpen,
  pendingPath,
  isDirty,
  onClose,
  onSaveAndOpen,
  onOpen,
}) => {
  const { t } = useLanguage();

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{t("dialog.file_drop.title")}</DialogTitle>
        <DialogDescription>{t("dialog.file_drop.desc")}</DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.actions.cancel")}
          </Button>

          {isDirty && (
            <Button
              variant="secondary"
              onClick={onSaveAndOpen}
              disabled={!pendingPath}
            >
              {t("dialog.file_drop.save_open")}
            </Button>
          )}

          <Button onClick={onOpen} disabled={!pendingPath}>
            {t("dialog.file_drop.open")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FileDropDialog;
