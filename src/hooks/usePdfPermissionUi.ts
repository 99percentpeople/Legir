import { useCallback, useMemo } from "react";
import { toast } from "sonner";

import { useLanguage } from "@/components/language-provider";
import {
  canPerformPdfPermissionOperation,
  type PdfPermissionOperation,
} from "@/lib/pdfPermissions";
import { useEditorStore } from "@/store/useEditorStore";
import type { PDFDocumentPermissions } from "@/types";

export const usePdfPermissionUi = (
  permissions: PDFDocumentPermissions | null | undefined,
) => {
  const { t } = useLanguage();
  const permissionPolicySource = useEditorStore(
    (state) => state.options.debugOptions,
  );
  const restrictedTitle = t("toolbar.permission_restricted");

  const can = useCallback(
    (operation: PdfPermissionOperation) =>
      canPerformPdfPermissionOperation(operation, permissions),
    [permissionPolicySource, permissions],
  );

  const canAll = useCallback(
    (operations: PdfPermissionOperation[]) =>
      operations.every((operation) => can(operation)),
    [can],
  );

  const disabledProps = useCallback(
    (operation: PdfPermissionOperation, title?: string) => {
      const allowed = can(operation);
      return {
        "aria-disabled": allowed ? undefined : true,
        disabled: !allowed,
        title: allowed ? title : restrictedTitle,
      };
    },
    [can, restrictedTitle],
  );

  const disabledAllProps = useCallback(
    (operations: PdfPermissionOperation[], title?: string) => {
      const allowed = canAll(operations);
      return {
        "aria-disabled": allowed ? undefined : true,
        disabled: !allowed,
        title: allowed ? title : restrictedTitle,
      };
    },
    [canAll, restrictedTitle],
  );

  const guard = useCallback(
    <T>(operation: PdfPermissionOperation, action: () => T): T | undefined => {
      if (can(operation)) return action();
      toast.error(restrictedTitle);
      return undefined;
    },
    [can, restrictedTitle],
  );

  const guardAll = useCallback(
    <T>(
      operations: PdfPermissionOperation[],
      action: () => T,
    ): T | undefined => {
      if (canAll(operations)) return action();
      toast.error(restrictedTitle);
      return undefined;
    },
    [canAll, restrictedTitle],
  );

  return useMemo(
    () => ({
      can,
      canAll,
      disabledAllProps,
      disabledProps,
      guard,
      guardAll,
      restrictedTitle,
    }),
    [
      can,
      canAll,
      disabledAllProps,
      disabledProps,
      guard,
      guardAll,
      restrictedTitle,
    ],
  );
};
