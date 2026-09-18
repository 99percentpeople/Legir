import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import AnnotationsPanel from "@/components/sidebar/AnnotationsPanel";
import type { AnnotationsPanelViewProps } from "@/components/sidebar/AnnotationsPanelView";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), view: vi.fn() }));
vi.mock("@/hooks/usePdfPermissionUi", () => ({
  usePdfPermissionUi: mocks.permission,
}));
vi.mock("@/components/sidebar/AnnotationsPanelView", () => ({
  AnnotationsPanelView: (props: AnnotationsPanelViewProps) => {
    mocks.view(props);
    return <div data-permission={String(props.canEditAnnotations)} />;
  },
}));

describe("application annotation permission adapter", () => {
  it.each([false, true])(
    "preserves the application's edit permission (%s)",
    async (allowed) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const can = vi.fn(() => allowed);
      mocks.permission.mockReturnValue({
        can,
        restrictedTitle: "Restricted by the PDF",
      });
      const element = document.createElement("div");
      const root = createRoot(element);
      const onDeleteAnnotation = vi.fn();
      try {
        await act(async () =>
          root.render(
            <AnnotationsPanel
              annotations={[]}
              documentPermissions={null}
              selectedId={null}
              onSelectControl={vi.fn()}
              onDeleteAnnotation={onDeleteAnnotation}
              onUpdateAnnotation={vi.fn()}
              onAddAnnotationReply={vi.fn()}
              onUpdateAnnotationReply={vi.fn()}
              onDeleteAnnotationReply={vi.fn()}
            />,
          ),
        );
        expect(mocks.permission).toHaveBeenLastCalledWith(null);
        expect(can).toHaveBeenCalledWith("edit_annotation");
        expect(mocks.view).toHaveBeenLastCalledWith(
          expect.objectContaining({
            canEditAnnotations: allowed,
            restrictedTitle: "Restricted by the PDF",
            onDeleteAnnotation,
          }),
        );
      } finally {
        await act(async () => root.unmount());
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );
});
