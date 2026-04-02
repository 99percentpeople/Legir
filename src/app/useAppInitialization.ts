import { useEffect } from "react";
import { useEditorStore, type EditorActions } from "../store/useEditorStore";
import { loadModels } from "@/services/ai";
import { getPlatformUserName, hasSavedDraftSession } from "@/services/platform";

export function useAppInitialization({
  setState,
}: {
  setState: EditorActions["setState"];
}) {
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const CANCELLED = Symbol("cancelled");
      const throwIfCancelled = () => {
        if (cancelled) throw CANCELLED;
      };

      void loadModels();

      setState({
        hasSavedSession: hasSavedDraftSession(),
      });

      try {
        const snapshot = useEditorStore.getState();
        const existing = snapshot.options?.userName;
        if (!existing) {
          const name = await getPlatformUserName();
          throwIfCancelled();
          const current = useEditorStore.getState().options?.userName;
          if (!current && typeof name === "string" && name.trim().length > 0) {
            useEditorStore.getState().setOptions({ userName: name.trim() });
          }
        }
      } catch (e) {
        if (e !== CANCELLED) {
          // ignore
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setState]);
}
