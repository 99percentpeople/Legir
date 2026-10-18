export type AiDocumentLinkSource =
  | { kind: "web"; path: string }
  | { kind: "tauri"; path: string };

export type AiDocumentLinkBinding = {
  id: string;
  sourceKey: string;
  filename: string;
  source?: AiDocumentLinkSource;
};
