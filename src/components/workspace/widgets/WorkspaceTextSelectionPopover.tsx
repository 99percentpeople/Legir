import type { PDFDocumentPermissions } from "@/types";
import { usePdfPermissionUi } from "@/hooks/usePdfPermissionUi";
import {
  WorkspaceTextSelectionPopoverView,
  type WorkspaceTextSelectionPopoverViewProps,
} from "./WorkspaceTextSelectionPopoverView";
export type { WorkspaceTextSelectionPopoverState } from "./WorkspaceTextSelectionPopoverView";

export interface WorkspaceTextSelectionPopoverProps extends Omit<
  WorkspaceTextSelectionPopoverViewProps,
  "canCopyText" | "canCreateAnnotations" | "restrictedTitle"
> {
  documentPermissions: PDFDocumentPermissions | null | undefined;
}
// Keep permission policy in the editor runtime; the view is reusable without a store.
export function WorkspaceTextSelectionPopover({
  documentPermissions,
  onHighlight,
  ...props
}: WorkspaceTextSelectionPopoverProps) {
  const permissions = usePdfPermissionUi(documentPermissions);
  return (
    <WorkspaceTextSelectionPopoverView
      {...props}
      canCopyText={permissions.can("copy_text")}
      canCreateAnnotations={permissions.can("create_annotation")}
      restrictedTitle={permissions.restrictedTitle}
      onHighlight={() => permissions.guard("create_annotation", onHighlight)}
    />
  );
}
