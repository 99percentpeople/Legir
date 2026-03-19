import React, { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useLanguage } from "../language-provider";

export type PdfPasswordPrompt = {
  id: string;
  reason: "need_password" | "incorrect_password";
};

interface PdfPasswordDialogProps {
  prompt: PdfPasswordPrompt | null;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}

const PdfPasswordDialog: React.FC<PdfPasswordDialogProps> = ({
  prompt,
  onCancel,
  onSubmit,
}) => {
  const { t } = useLanguage();
  const [password, setPassword] = useState("");
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setPassword("");
    setIsVisible(false);
  }, [prompt?.id]);

  const toggleVisibility = () => setIsVisible((prev) => !prev);

  const handleSubmit = () => {
    if (!prompt) return;
    onSubmit(password);
  };

  const title =
    prompt?.reason === "incorrect_password"
      ? t("dialog.pdf_password.title_incorrect")
      : t("dialog.pdf_password.title");

  const description =
    prompt?.reason === "incorrect_password"
      ? t("dialog.pdf_password.desc_incorrect")
      : t("dialog.pdf_password.desc");

  return (
    <Dialog open={!!prompt} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription id="pdf-password-description">
          {description}
        </DialogDescription>

        <div className="relative">
          <Input
            aria-describedby="pdf-password-description"
            className="pe-9"
            id="pdf-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("dialog.pdf_password.password_label")}
            type={isVisible ? "text" : "password"}
            value={password}
            autoFocus
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              handleSubmit();
            }}
          />

          <button
            aria-controls="pdf-password"
            aria-label={isVisible ? "Hide password" : "Show password"}
            aria-pressed={isVisible}
            className="text-muted-foreground/80 hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 absolute inset-y-0 end-0 flex h-full w-9 items-center justify-center rounded-e-md transition-[color,box-shadow] outline-none focus:z-10 focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
            onClick={toggleVisibility}
            type="button"
          >
            {isVisible ? (
              <EyeOff aria-hidden="true" size={16} />
            ) : (
              <Eye aria-hidden="true" size={16} />
            )}
          </button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.actions.cancel")}
          </Button>
          <Button onClick={handleSubmit}>{t("common.actions.continue")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PdfPasswordDialog;
