import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { useAiChatController } from "@/hooks/useAiChatController";
import type { AiWorkspace } from "@/services/ai/chat/workspace";
import type { AiChatMessageAttachment } from "@/services/ai/chat/types";
import { preload } from "@/utils/preload";
import { preloadProviderLogos } from "@/components/ProviderLogo";

type Controller = ReturnType<typeof useAiChatController>;
const GlobalAiControllerHost = preload(
  () => import("./GlobalAiControllerHost"),
);
export async function preloadGlobalAiController() {
  await Promise.allSettled([
    GlobalAiControllerHost.preload(),
    preloadProviderLogos(),
  ]);
}
interface GlobalAiState {
  controller: Controller | null;
  requestController: () => void;
  workspace: AiWorkspace;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  attachments: AiChatMessageAttachment[];
  setAttachments: React.Dispatch<
    React.SetStateAction<AiChatMessageAttachment[]>
  >;
}
const GlobalAiContext = createContext<GlobalAiState | null>(null);
export const useGlobalAi = () => useContext(GlobalAiContext);

/** Lazily create one controller, then retain it until the window is closed.
 * Panels and document tabs can appear/disappear without owning the AI run.
 */
export function GlobalAiProvider({
  workspace,
  children,
}: {
  workspace: AiWorkspace;
  children: React.ReactNode;
}) {
  const [requested, setRequested] = useState(false);
  const [controller, setController] = useState<Controller | null>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AiChatMessageAttachment[]>([]);
  const requestController = useCallback(() => {
    void preloadGlobalAiController();
    setRequested(true);
  }, []);
  const value = useMemo(
    () => ({
      controller,
      requestController,
      workspace,
      draft,
      setDraft,
      attachments,
      setAttachments,
    }),
    [controller, requestController, workspace, draft, attachments],
  );
  return (
    <GlobalAiContext.Provider value={value}>
      {requested && (
        <React.Suspense fallback={null}>
          <GlobalAiControllerHost
            workspace={workspace}
            onChange={setController}
          />
        </React.Suspense>
      )}
      {children}
    </GlobalAiContext.Provider>
  );
}
