import { pdfEngine } from "../engine";

export type VerifyPdfOwnerPasswordResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing_encrypt_dictionary"
        | "unsupported_encryption"
        | "incorrect_password";
    };

export const verifyPdfOwnerPassword = async (
  pdfBytes: Uint8Array,
  password: string,
): Promise<VerifyPdfOwnerPasswordResult> => {
  try {
    const result = await pdfEngine.verifyOwnerPassword({
      bytes: pdfBytes,
      password,
    });
    if (!result.encrypted)
      return { ok: false, reason: "missing_encrypt_dictionary" };
    return result.owner
      ? { ok: true }
      : { ok: false, reason: "incorrect_password" };
  } catch {
    return { ok: false, reason: "unsupported_encryption" };
  }
};
