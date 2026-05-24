import type {
  EditorMode,
  FormField,
  PDFDocumentPermissions,
  PDFPermissionDirtyScopes,
  Tool,
} from "@/types";

export const UNRESTRICTED_PDF_PERMISSIONS: PDFDocumentPermissions = {
  isEncrypted: false,
  hasOwnerRestrictions: false,
  canOpen: true,
  canModifyContents: true,
  canModifyAnnotations: true,
  canFillForms: true,
  canCopy: true,
  canCopyForAccessibility: true,
  canPrint: true,
  canPrintHighQuality: true,
  canAssemble: true,
  rawFlags: null,
};

export const EMPTY_PDF_PERMISSION_DIRTY_SCOPES: PDFPermissionDirtyScopes = {
  modifyContents: false,
  modifyAnnotations: false,
  fillForms: false,
};

export const clonePdfPermissionDirtyScopes = (
  scopes: PDFPermissionDirtyScopes,
): PDFPermissionDirtyScopes => ({ ...scopes });

export const mergePdfPermissionDirtyScopes = (
  base: PDFPermissionDirtyScopes,
  patch: Partial<PDFPermissionDirtyScopes>,
): PDFPermissionDirtyScopes => ({
  modifyContents: base.modifyContents || !!patch.modifyContents,
  modifyAnnotations: base.modifyAnnotations || !!patch.modifyAnnotations,
  fillForms: base.fillForms || !!patch.fillForms,
});

export const getEffectivePdfPermissions = (
  permissions: PDFDocumentPermissions | null | undefined,
): PDFDocumentPermissions => permissions ?? UNRESTRICTED_PDF_PERMISSIONS;

export const hasPdfOwnerRestrictions = (
  permissions: PDFDocumentPermissions | null | undefined,
) => getEffectivePdfPermissions(permissions).hasOwnerRestrictions;

export interface PdfPermissionPolicy {
  ignorePdfPermissions: boolean;
}

export type PdfPermissionPolicyProvider = () => Partial<PdfPermissionPolicy>;

const DEFAULT_PDF_PERMISSION_POLICY: PdfPermissionPolicy = {
  ignorePdfPermissions: false,
};

let pdfPermissionPolicyProvider: PdfPermissionPolicyProvider = () =>
  DEFAULT_PDF_PERMISSION_POLICY;

export const setPdfPermissionPolicyProvider = (
  provider: PdfPermissionPolicyProvider,
) => {
  pdfPermissionPolicyProvider = provider;
};

export const getPdfPermissionPolicy = (): PdfPermissionPolicy => ({
  ...DEFAULT_PDF_PERMISSION_POLICY,
  ...pdfPermissionPolicyProvider(),
});

const shouldIgnorePdfPermissions = (): boolean =>
  getPdfPermissionPolicy().ignorePdfPermissions;

export const canModifyPdfContents = (
  permissions: PDFDocumentPermissions | null | undefined,
) =>
  shouldIgnorePdfPermissions() ||
  getEffectivePdfPermissions(permissions).canModifyContents;

export const canModifyPdfAnnotations = (
  permissions: PDFDocumentPermissions | null | undefined,
) =>
  shouldIgnorePdfPermissions() ||
  getEffectivePdfPermissions(permissions).canModifyAnnotations;

export const canFillPdfForms = (
  permissions: PDFDocumentPermissions | null | undefined,
) =>
  shouldIgnorePdfPermissions() ||
  getEffectivePdfPermissions(permissions).canFillForms;

export const canPrintPdf = (
  permissions: PDFDocumentPermissions | null | undefined,
) =>
  shouldIgnorePdfPermissions() ||
  getEffectivePdfPermissions(permissions).canPrint;

export type PdfPermissionOperation =
  | "create_annotation"
  | "edit_annotation"
  | "delete_annotation"
  | "edit_form_structure"
  | "fill_form_value"
  | "edit_document_metadata"
  | "copy_text"
  | "extract_text"
  | "print";

export class PdfPermissionDeniedError extends Error {
  readonly code = "PDF_PERMISSION_DENIED";

  constructor(
    readonly operation: PdfPermissionOperation,
    message = `PDF permissions do not allow operation: ${operation}`,
  ) {
    super(message);
    this.name = "PdfPermissionDeniedError";
  }
}

export const assertPdfPermissionOperation = (
  operation: PdfPermissionOperation,
  permissions: PDFDocumentPermissions | null | undefined,
) => {
  if (canPerformPdfPermissionOperation(operation, permissions)) return;
  throw new PdfPermissionDeniedError(operation);
};

export const canPerformPdfPermissionOperation = (
  operation: PdfPermissionOperation,
  permissions: PDFDocumentPermissions | null | undefined,
): boolean => {
  switch (operation) {
    case "create_annotation":
    case "edit_annotation":
    case "delete_annotation":
      return canModifyPdfAnnotations(permissions);
    case "edit_form_structure":
    case "edit_document_metadata":
      return canModifyPdfContents(permissions);
    case "fill_form_value":
      return canModifyPdfContents(permissions) || canFillPdfForms(permissions);
    case "copy_text":
    case "extract_text":
      return (
        shouldIgnorePdfPermissions() ||
        getEffectivePdfPermissions(permissions).canCopy
      );
    case "print":
      return canPrintPdf(permissions);
  }
};

export const isFormFieldValueUpdate = (
  updates: Partial<FormField>,
): boolean => {
  const keys = Object.keys(updates);
  if (keys.length === 0) return false;
  return keys.every((key) =>
    ["value", "isChecked", "signatureData"].includes(key),
  );
};

export const canUpdateFormFieldWithPdfPermissions = (
  permissions: PDFDocumentPermissions | null | undefined,
  updates: Partial<FormField>,
): boolean => {
  if (canModifyPdfContents(permissions)) return true;
  return canFillPdfForms(permissions) && isFormFieldValueUpdate(updates);
};

export const getFormFieldUpdateDirtyScopes = (
  permissions: PDFDocumentPermissions | null | undefined,
  updates: Partial<FormField>,
): Partial<PDFPermissionDirtyScopes> => {
  if (!canModifyPdfContents(permissions) && isFormFieldValueUpdate(updates)) {
    return { fillForms: true };
  }
  return { modifyContents: true };
};

export const canUseToolWithPdfPermissions = (
  tool: Tool,
  mode: EditorMode,
  permissions: PDFDocumentPermissions | null | undefined,
): boolean => {
  if (tool === "select" || tool === "select_text" || tool === "pan") {
    return true;
  }

  if (mode === "form") {
    return canModifyPdfContents(permissions);
  }

  return canModifyPdfAnnotations(permissions);
};

export const canUseModeWithPdfPermissions = (
  mode: EditorMode,
  permissions: PDFDocumentPermissions | null | undefined,
): boolean => {
  return mode === "form"
    ? canModifyPdfContents(permissions) || canFillPdfForms(permissions)
    : canModifyPdfAnnotations(permissions);
};

export const getPdfPermissionSaveBlockReason = (
  permissions: PDFDocumentPermissions | null | undefined,
  dirtyScopes: PDFPermissionDirtyScopes | null | undefined,
): "modify_contents" | "modify_annotations" | "fill_forms" | null => {
  if (!dirtyScopes) return null;
  if (shouldIgnorePdfPermissions()) return null;

  if (dirtyScopes.modifyContents && !canModifyPdfContents(permissions)) {
    return "modify_contents";
  }
  if (dirtyScopes.modifyAnnotations && !canModifyPdfAnnotations(permissions)) {
    return "modify_annotations";
  }
  if (
    dirtyScopes.fillForms &&
    !canModifyPdfContents(permissions) &&
    !canFillPdfForms(permissions)
  ) {
    return "fill_forms";
  }

  return null;
};
