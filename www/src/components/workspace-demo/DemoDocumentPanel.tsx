import { useState } from "react";
import type { PDFMetadata } from "@/types";
import { DocumentPropertiesPanel } from "@/components/properties-panel/DocumentPropertiesPanel";
import type { DemoPanelProps } from "./DemoPanels";

/** The app's actual information form; edits are confined to the sample document. */
export function DemoDocumentPanel({
  state,
  dispatch,
  width,
  onResize,
  floating,
  filename,
  onFilenameChange,
}: DemoPanelProps & {
  filename: string;
  onFilenameChange: (name: string) => void;
}) {
  const [metadata, setMetadata] = useState<PDFMetadata>({
    title: "Reading notes",
    author: "Legir",
    subject: "A little space to think",
    creator: "Legir demo",
  });
  const [password, setPassword] = useState<string | null>(null);
  const [preserve, setPreserve] = useState(false);
  return (
    <DocumentPropertiesPanel
      metadata={metadata}
      onMetadataChange={(updates) =>
        setMetadata((previous) => ({ ...previous, ...updates }))
      }
      filename={filename}
      onFilenameChange={onFilenameChange}
      exportPassword={password}
      pdfOpenPassword={null}
      pdfOwnerUnlocked={false}
      preservePdfOwnerRestrictionsOnSave={preserve}
      onExportPasswordChange={setPassword}
      onOwnerPasswordUnlock={async () => false}
      sourceDocumentPermissions={null}
      onPreserveOwnerRestrictionsOnSaveChange={setPreserve}
      canModifyContents
      isOpen={state.panel === "document"}
      isFloating={floating}
      onOpen={() => dispatch({ type: "panel", panel: "document" })}
      onCollapse={() => dispatch({ type: "panel", panel: null })}
      onClose={() => dispatch({ type: "panel", panel: null })}
      width={width}
      onResize={onResize}
      onTriggerHistorySave={() => {}}
    />
  );
}
