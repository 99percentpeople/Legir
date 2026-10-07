import type { EditorViewApi } from "@/store/useEditorView";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import type { AppEventMap, EventBus } from "@/lib/eventBus";

export interface AiWorkspaceDocument {
  id: string;
  store: EditorViewApi;
  workerService: PDFWorkerService;
  events: EventBus<AppEventMap>;
  signal: AbortSignal;
  getRoot: () => HTMLElement | null;
}

export interface AiWorkspace {
  getActiveDocumentId: () => string | null;
  listDocuments: () => Array<{
    documentId: string;
    filename: string;
    pageCount: number;
    isActive: boolean;
    isDirty: boolean;
    loadState: string;
  }>;
  getDocument: (documentId: string) => AiWorkspaceDocument | null;
  activateDocument: (documentId: string) => boolean;
}
