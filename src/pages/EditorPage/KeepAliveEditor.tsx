import React from "react";
import {
  EditorRuntimeProvider,
  useEditorDocumentCommandsRuntime,
  useEditorFileDragRuntime,
  useEditorTabsRuntime,
} from "@/app/editorRuntime";
import { EditorViewContext } from "@/store/useEditorView";
import {
  EditorTabContext,
  EditorTabActiveContext,
} from "@/app/editorTabs/context";
import { EditorTabStrip } from "./components/EditorTabStrip";
import EditorPage from "./index";

/** Retain DOM, local React state and transferred canvases until a tab closes.
 * visibility (not display:none) preserves viewport dimensions and scroll offsets.
 * Descendants must not transition inherited visibility: inactive controls would
 * remain painted over the active tab until their transitions finish.
 */
export default function KeepAliveEditor() {
  const tabs = useEditorTabsRuntime();
  const commands = useEditorDocumentCommandsRuntime();
  const drag = useEditorFileDragRuntime();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EditorTabStrip />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {tabs.sessions?.map((session) => {
          const runtime = session.runtime;
          const active = session.id === tabs.activeTabId;
          runtime.active = active;
          return (
            <div
              key={session.id}
              data-editor-tab={session.id}
              data-editor-active={active ? "true" : "false"}
              ref={(element) => {
                runtime.root = element;
              }}
              className="absolute inset-0 flex min-h-0 flex-col"
              style={{
                visibility: active ? "visible" : "hidden",
                pointerEvents: active ? undefined : "none",
              }}
              inert={!active}
              aria-hidden={!active}
            >
              <EditorTabContext.Provider value={runtime}>
                <EditorTabActiveContext.Provider value={active}>
                  <EditorViewContext.Provider value={runtime.store}>
                    <EditorRuntimeProvider
                      tabs={{ ...tabs, activeTabId: session.id }}
                      document={{
                        ...commands,
                        ...drag,
                        sessionRenderKey: session.id,
                        workerService: session.workerService,
                      }}
                    >
                      <EditorPage />
                    </EditorRuntimeProvider>
                  </EditorViewContext.Provider>
                </EditorTabActiveContext.Provider>
              </EditorTabContext.Provider>
            </div>
          );
        })}
      </div>
    </div>
  );
}
