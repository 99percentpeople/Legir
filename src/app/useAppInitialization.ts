import { useEffect } from "react";
import { useEditorStore } from "../store/useEditorStore";
import { loadModels } from "@/services/ai";
import { getPlatformUserName } from "@/services/platform";

export function useAppInitialization() {
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const CANCELLED = Symbol("cancelled");
      const throwIfCancelled = () => {
        if (cancelled) throw CANCELLED;
      };

      void loadModels();

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
  }, []);
}
