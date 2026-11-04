import { pdfEvents } from "../host.js";
import { EncryptedPDFError } from "@legir/pdfium/authoring";

export type PdfLoadSession = {
  id: string;
  requestPassword: (
    reason: "need_password" | "incorrect_password",
  ) => Promise<string>;
  getLastPassword: () => string | undefined;
  markProgress: (loaded: number, total?: number) => void;
  finish: (ok: boolean) => void;
};

export const createPdfLoadSession = (
  label?: string,
  signal?: AbortSignal,
): PdfLoadSession => {
  const id = `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let lastPassword: string | undefined = undefined;

  const markProgress = (loaded: number, total?: number) => {
    pdfEvents.emit("pdf:loadProgress", {
      id,
      loaded,
      total,
    });
  };

  pdfEvents.emit("pdf:loadStart", { id, label });
  markProgress(0, 1);

  const requestPassword = (reason: "need_password" | "incorrect_password") =>
    new Promise<string>((resolve, reject) => {
      let settled = false;
      const submit = (password: string) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", cancel);
        lastPassword = password;
        resolve(password);
      };
      const cancel = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", cancel);
        reject(new DOMException("Password prompt cancelled", "AbortError"));
      };

      if (signal?.aborted) {
        cancel();
        return;
      }
      signal?.addEventListener("abort", cancel, { once: true });
      pdfEvents.emit("pdf:passwordRequired", {
        id,
        reason,
        submit,
        cancel,
      });
    });

  const finish = (ok: boolean) => {
    pdfEvents.emit("pdf:loadEnd", { id, ok });
  };

  return {
    id,
    requestPassword,
    getLastPassword: () => lastPassword,
    markProgress,
    finish,
  };
};

export const getPdfPasswordReason = (
  error: unknown,
  hadPassword: boolean,
): "need_password" | "incorrect_password" | null => {
  if (error instanceof EncryptedPDFError) {
    return hadPassword ? "incorrect_password" : "need_password";
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("password")) {
      return hadPassword ? "incorrect_password" : "need_password";
    }
  }

  return null;
};
