import { preload } from "@/utils/preload";

// Rendering and preloading share these instances. Importing the registry does
// not mount UI or start document runtimes.
export const HomePage = preload(() => import("@/pages/HomePage"));
export const EditorPage = preload(
  () => import("@/pages/EditorPage/KeepAliveEditor"),
);
export const Workspace = preload(
  () => import("@/components/workspace/Workspace"),
);
export const PageEditor = preload(
  () => import("@/components/page-editor/PageEditor"),
);
export const KeyboardShortcutsHelp = preload(
  () => import("@/components/KeyboardShortcutsHelp"),
);
export const SettingsDialog = preload(
  () => import("@/components/dialogs/SettingsDialog"),
);
export const PdfPasswordDialog = preload(
  () => import("@/components/dialogs/PdfPasswordDialog"),
);
export const EditorCloseConfirmDialog = preload(() =>
  import("@/pages/EditorPage/EditorCloseConfirmDialog").then((module) => ({
    default: module.EditorCloseConfirmDialog,
  })),
);

/** Start alongside file I/O; the first document need not wait for route chunks. */
export async function preloadEditor() {
  await Promise.allSettled([
    EditorPage.preload(),
    Workspace.preload(),
    PdfPasswordDialog.preload(),
  ]);
}
