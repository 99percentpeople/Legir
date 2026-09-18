import type { PDFDocumentPermissions } from "@/types";
import { usePdfPermissionUi } from "@/hooks/usePdfPermissionUi";
import {
  AnnotationsPanelView,
  type AnnotationsPanelViewProps,
} from "./AnnotationsPanelView";

type AnnotationsProps = Omit<
  AnnotationsPanelViewProps,
  "canEditAnnotations" | "restrictedTitle"
> & {
  documentPermissions?: PDFDocumentPermissions | null;
};

/** Application adapter: permission policy stays out of the shared display view. */
export default function AnnotationsPanel({
  documentPermissions,
  ...props
}: AnnotationsProps) {
  const permissionUi = usePdfPermissionUi(documentPermissions);
  return (
    <AnnotationsPanelView
      {...props}
      canEditAnnotations={permissionUi.can("edit_annotation")}
      restrictedTitle={permissionUi.restrictedTitle}
    />
  );
}
