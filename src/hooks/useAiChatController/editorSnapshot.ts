import type { AiChatEditorState } from "@/store/selectors";

// Read the whole live snapshot at tool-execution time. A reader belongs to one
// document: an old asynchronous AI task must never combine its worker with a
// newly activated tab's data.
export function createAiChatSnapshotReader(
  readState: () => AiChatEditorState,
  documentBytes: AiChatEditorState["pdfBytes"],
  isActive: () => boolean = () => true,
): () => AiChatEditorState {
  return () => {
    const snapshot = readState();
    if (!isActive() || snapshot.pdfBytes !== documentBytes) {
      throw new Error("The AI document is no longer active.");
    }
    return snapshot;
  };
}
